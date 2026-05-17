import { EventSink, RuntimeEvent } from './event_sink.js';
import { SqliteStateStore } from './sqlite_state_store.js';

/**
 * SQLite-backed EventSink that stores runtime events in the events table.
 *
 * 将运行时事件存储在 events 表的 SQLite 事件接收器。
 *
 * Shares the database connection from SqliteStateStore.
 *
 * @public
 */
export class SqliteEventSink implements EventSink {
  private readonly db: ReturnType<SqliteStateStore['getDb']>;

  constructor(options: { store: SqliteStateStore }) {
    this.db = options.store.getDb();
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        details TEXT
      );
    `);
  }

  emit(event: RuntimeEvent): Promise<void> {
    try {
      this.db.run(
        'INSERT INTO events (run_id, kind, at, details) VALUES (?, ?, ?, ?)',
        [
          event.run_id,
          event.kind,
          event.at,
          event.details !== undefined ? JSON.stringify(event.details) : null,
        ],
      );
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(
        new Error(`Failed to persist event: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}
