import { Database } from 'bun:sqlite';
import { RunState } from '@sop-runtime/definition';
import {
  ClaimRunStartParams,
  ClaimRunStartResult,
  RunRecord,
  RunRecordLookup,
  StateStore,
} from './state_store.js';
import { RuntimeError } from './runtime_error.js';
import { isCooldownActive } from './state_store_helpers.js';

const SCHEMA_VERSION = 1;
const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * SQLite-backed StateStore for production and development.
 *
 * 生产与开发环境通用的 SQLite 持久化 StateStore。
 *
 * Supports execute IMMEDIATE transactions for atomic claimRunStart and
 * version-based compare-and-swap (CAS) for concurrent save safety.
 *
 * @public
 */
export class SqliteStateStore implements StateStore {
  private readonly db: Database;

  /**
   * @param options.dbPath - Path to the SQLite database file, or ':memory:' for in-memory.
   */
  constructor(options: { dbPath: string }) {
    this.db = new Database(options.dbPath, { strict: true });
    this.db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        run_id TEXT PRIMARY KEY,
        sop_id TEXT NOT NULL,
        sop_version TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        concurrency_key TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        completed_at TEXT
      );
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_records_idempotency
        ON records(sop_id, sop_version, idempotency_key);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_records_concurrency
        ON records(sop_id, sop_version, concurrency_key);
    `);

    this.db.exec('CREATE TABLE IF NOT EXISTS _meta (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL);');
    this.db.run('INSERT OR IGNORE INTO _meta (id, schema_version) VALUES (1, ?1)', [SCHEMA_VERSION]);
  }

  /** Expose the underlying database for shared access (e.g. SqliteEventSink). */
  getDb(): Database {
    return this.db;
  }

  async loadRun(runId: string): Promise<RunState | null> {
    const snapshot = await this.loadRunSnapshot(runId);
    return snapshot?.state ?? null;
  }

  async loadRunSnapshot(runId: string): Promise<{ state: RunState; revision?: string } | null> {
    const row = this.db.query<{ state: string; version: number }, [string]>(
      'SELECT state, version FROM runs WHERE run_id = ?1',
    ).get(runId);
    if (row === null) return null;
    return { 'state': JSON.parse(row.state) as RunState, 'revision': String(row.version) };
  }

  async saveRun(state: RunState, options?: { expected_revision?: string }): Promise<void> {
    const stateJson = JSON.stringify(state);
    const updatedAt = state.updated_at ?? '';

    if (options?.expected_revision !== undefined) {
      // CAS write
      const result = this.db.run(
        'UPDATE runs SET state = ?1, version = version + 1, updated_at = ?2 WHERE run_id = ?3 AND version = ?4',
        [stateJson, updatedAt, state.run_id, Number(options.expected_revision)],
      );
      if (result.changes === 0) {
        const existing = this.db.query<{ run_id: string }, [string]>(
          'SELECT run_id FROM runs WHERE run_id = ?1',
        ).get(state.run_id);
        if (existing === null) {
          // First insert
          this.db.run(
            'INSERT INTO runs (run_id, state, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
            [state.run_id, stateJson, state.created_at ?? updatedAt, updatedAt],
          );
        } else {
          throw new RuntimeError('cas_conflict', {
            'message': 'Run state was modified by another worker (CAS version mismatch).',
            'details': { 'run_id': state.run_id },
          });
        }
      }
    } else {
      // Unconditional write (no CAS)
      const result = this.db.run(
        'UPDATE runs SET state = ?1, version = version + 1, updated_at = ?2 WHERE run_id = ?3',
        [stateJson, updatedAt, state.run_id],
      );
      if (result.changes === 0) {
        this.db.run(
          'INSERT INTO runs (run_id, state, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
          [state.run_id, stateJson, state.created_at ?? updatedAt, updatedAt],
        );
      }
    }
  }

  async saveRunState(state: RunState, options?: { expected_revision?: string }): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stateJson = JSON.stringify(state);
      const updatedAt = state.updated_at ?? '';

      if (options?.expected_revision !== undefined) {
        const result = this.db.run(
          'UPDATE runs SET state = ?1, version = version + 1, updated_at = ?2 WHERE run_id = ?3 AND version = ?4',
          [stateJson, updatedAt, state.run_id, Number(options.expected_revision)],
        );
        if (result.changes === 0) {
          // Run may not exist, or version mismatch — either way it's a CAS conflict
          throw new RuntimeError('cas_conflict', {
            'message': 'Run state was modified by another worker (CAS version mismatch).',
            'details': { 'run_id': state.run_id },
          });
        }
      } else {
        const result = this.db.run(
          'UPDATE runs SET state = ?1, version = version + 1, updated_at = ?2 WHERE run_id = ?3',
          [stateJson, updatedAt, state.run_id],
        );
        if (result.changes === 0) {
          // Run does not exist yet — insert new row (same semantics as saveRun)
          this.db.run(
            'INSERT INTO runs (run_id, state, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
            [state.run_id, stateJson, state.created_at ?? updatedAt, updatedAt],
          );
        }
      }

      const isTerminated = state.phase === 'terminated' ? 1 : 0;
      this.db.run(
        'UPDATE records SET updated_at = ?1, completed_at = CASE WHEN ?2 = 1 THEN ?3 ELSE completed_at END WHERE run_id = ?4',
        [updatedAt, isTerminated, updatedAt, state.run_id],
      );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async loadRunRecord(runId: string): Promise<RunRecord | null> {
    const row = this.db.query<RunRecordRow, [string]>(
      'SELECT run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at FROM records WHERE run_id = ?1',
    ).get(runId);
    if (row === null) return null;
    return rowToRecord(row);
  }

  async saveRunRecord(record: RunRecord): Promise<void> {
    // Upsert only when run_id matches. If a different run_id conflicts on
    // the (sop_id, sop_version, idempotency_key) unique index, the constraint
    // will surface as a SQLITE_CONSTRAINT_UNIQUE error rather than silently
    // replacing the existing record.
    this.db.run(
      `INSERT INTO records (run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(run_id) DO UPDATE SET
         sop_id = excluded.sop_id,
         sop_version = excluded.sop_version,
         idempotency_key = excluded.idempotency_key,
         concurrency_key = excluded.concurrency_key,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`,
      [
        record.run_id, record.sop_id, record.sop_version,
        record.idempotency_key, record.concurrency_key,
        record.created_at ?? null, record.updated_at ?? null, record.completed_at ?? null,
      ],
    );
  }

  async claimRunStart(params: ClaimRunStartParams): Promise<ClaimRunStartResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 1. Check idempotency
      const idempotentRecord = this.db.query<RunRecordRow, [string, string, string]>(
        `SELECT run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at
         FROM records
         WHERE sop_id = ?1 AND sop_version = ?2 AND idempotency_key = ?3`,
      ).get(params.record.sop_id, params.record.sop_version, params.record.idempotency_key);

      if (idempotentRecord !== null) {
        const state = this.loadState(idempotentRecord.run_id);
        if (state !== null) {
          this.db.exec('COMMIT');
          return {
            'state': state,
            'record': rowToRecord(idempotentRecord),
            'reason': 'idempotent_replay' as const,
          };
        }
      }

      // 2. Check cooldown
      const completedRows = this.db.query<RunRecordRow, [string, string, string]>(
        `SELECT run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at
         FROM records
         WHERE sop_id = ?1 AND sop_version = ?2 AND concurrency_key = ?3 AND completed_at IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 1`,
      ).all(params.record.sop_id, params.record.sop_version, params.record.concurrency_key);

      if (completedRows.length > 0) {
        const latest = completedRows[0]!;
        if (isCooldownActive({
          'record': rowToRecord(latest),
          'cooldown_secs': params.cooldown_secs,
          'now': params.now,
        })) {
          const state = this.loadState(latest.run_id);
          if (state !== null) {
            this.db.exec('COMMIT');
            return {
              'state': state,
              'record': rowToRecord(latest),
              'reason': 'cooldown_active' as const,
            };
          }
        }
      }

      // 3. Check concurrency
      const runningRows = this.db.query<RunRecordRow, [string, string, string]>(
        `SELECT r.run_id, r.sop_id, r.sop_version, r.idempotency_key, r.concurrency_key, r.created_at, r.updated_at, r.completed_at
         FROM records r
         INNER JOIN runs s ON s.run_id = r.run_id
         WHERE r.sop_id = ?1 AND r.sop_version = ?2 AND r.concurrency_key = ?3
         AND json_extract(s.state, '$.status') = 'running'`,
      ).all(params.record.sop_id, params.record.sop_version, params.record.concurrency_key);

      if (runningRows.length > 0) {
        const runningRecord = runningRows[0]!;
        const state = this.loadState(runningRecord.run_id);
        if (state !== null) {
          if (params.concurrency_mode === 'singleflight') {
            this.db.exec('COMMIT');
            return { 'state': state, 'record': rowToRecord(runningRecord), 'reason': 'singleflight_joined' as const };
          }
          if (params.concurrency_mode === 'drop_if_running') {
            this.db.exec('COMMIT');
            return { 'state': state, 'record': rowToRecord(runningRecord), 'reason': 'dropped_running' as const };
          }
        }
      }

      // 4. Check for run_id collision
      const existingRun = this.db.query<{ run_id: string }, [string]>(
        'SELECT run_id FROM runs WHERE run_id = ?1',
      ).get(params.state.run_id);
      const existingRecord = this.db.query<{ run_id: string }, [string]>(
        'SELECT run_id FROM records WHERE run_id = ?1',
      ).get(params.record.run_id);
      if (existingRun !== null || existingRecord !== null) {
        throw new RuntimeError('run_id_conflict', {
          'message': 'Run id is already claimed by a different start request.',
          'details': { 'run_id': params.state.run_id },
        });
      }

      // 5. Create new run
      const stateJson = JSON.stringify(params.state);
      this.db.run(
        'INSERT INTO runs (run_id, state, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
        [params.state.run_id, stateJson, params.state.created_at ?? params.now, params.now],
      );
      this.db.run(
        `INSERT INTO records (run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        [
          params.record.run_id, params.record.sop_id, params.record.sop_version,
          params.record.idempotency_key, params.record.concurrency_key,
          params.record.created_at ?? params.now, params.record.updated_at ?? params.now,
        ],
      );

      this.db.exec('COMMIT');
      return {
        'state': structuredClone(params.state),
        'record': structuredClone(params.record),
        'reason': 'created' as const,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findRunByIdempotencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    const row = this.db.query<RunRecordRow, [string, string, string]>(
      `SELECT run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at
       FROM records WHERE sop_id = ?1 AND sop_version = ?2 AND idempotency_key = ?3`,
    ).get(lookup.sop_id, lookup.sop_version, lookup.key);
    return row === null ? null : rowToRecord(row);
  }

  async findRunningRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    const row = this.db.query<RunRecordRow, [string, string, string]>(
      `SELECT r.run_id, r.sop_id, r.sop_version, r.idempotency_key, r.concurrency_key, r.created_at, r.updated_at, r.completed_at
       FROM records r
       INNER JOIN runs s ON s.run_id = r.run_id
       WHERE r.sop_id = ?1 AND r.sop_version = ?2 AND r.concurrency_key = ?3
       AND json_extract(s.state, '$.status') = 'running'
       LIMIT 1`,
    ).get(lookup.sop_id, lookup.sop_version, lookup.key);
    return row === null ? null : rowToRecord(row);
  }

  async findLatestRunByConcurrencyKey(lookup: RunRecordLookup): Promise<RunRecord | null> {
    const row = this.db.query<RunRecordRow, [string, string, string]>(
      `SELECT run_id, sop_id, sop_version, idempotency_key, concurrency_key, created_at, updated_at, completed_at
       FROM records
       WHERE sop_id = ?1 AND sop_version = ?2 AND concurrency_key = ?3
       ORDER BY updated_at DESC
       LIMIT 1`,
    ).get(lookup.sop_id, lookup.sop_version, lookup.key);
    return row === null ? null : rowToRecord(row);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private loadState(runId: string): RunState | null {
    const row = this.db.query<{ state: string }, [string]>(
      'SELECT state FROM runs WHERE run_id = ?1',
    ).get(runId);
    if (row === null) return null;
    return JSON.parse(row.state) as RunState;
  }
}

// ---------------------------------------------------------------------------
// Internal row type for records table
// ---------------------------------------------------------------------------

interface RunRecordRow {
  run_id: string;
  sop_id: string;
  sop_version: string;
  idempotency_key: string;
  concurrency_key: string;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

function rowToRecord(row: RunRecordRow): RunRecord {
  return {
    'run_id': row.run_id,
    'sop_id': row.sop_id,
    'sop_version': row.sop_version,
    'idempotency_key': row.idempotency_key,
    'concurrency_key': row.concurrency_key,
    'created_at': row.created_at ?? undefined,
    'updated_at': row.updated_at ?? undefined,
    'completed_at': row.completed_at ?? undefined,
  };
}
