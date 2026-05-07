import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonlEventSink } from '../src/jsonl_event_sink.js';
import { RuntimeEvent } from '../src/index.js';

describe('JsonlEventSink', () => {
  let tmpDir: string;
  let filePath: string;
  const baseTmp = tmpdir();

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(baseTmp, 'jsonl-test-'));
    filePath = join(tmpDir, 'events.jsonl');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('writes a single JSONL line', async () => {
    const sink = new JsonlEventSink({ filePath });
    const event: RuntimeEvent = {
      kind: 'run_started',
      run_id: 'run_001',
      at: '2026-01-01T00:00:00.000Z',
    };
    await sink.emit(event);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe(JSON.stringify(event) + '\n');
  });

  test('writes multiple lines in order', async () => {
    const sink = new JsonlEventSink({ filePath });
    const events: RuntimeEvent[] = [
      { kind: 'run_started', run_id: 'run_001', at: '2026-01-01T00:00:00.000Z' },
      { kind: 'step_packet_built', run_id: 'run_001', at: '2026-01-01T00:00:01.000Z' },
      { kind: 'run_terminated', run_id: 'run_001', at: '2026-01-01T00:00:02.000Z' },
    ];
    for (const e of events) {
      await sink.emit(e);
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).kind).toBe('run_started');
    expect(JSON.parse(lines[1]!).kind).toBe('step_packet_built');
    expect(JSON.parse(lines[2]!).kind).toBe('run_terminated');
  });

  test('concurrent emits are serialized in order', async () => {
    const sink = new JsonlEventSink({ filePath });
    const events: RuntimeEvent[] = [
      { kind: 'run_started', run_id: 'run_001', at: '2026-01-01T00:00:00.000Z' },
      { kind: 'step_packet_built', run_id: 'run_001', at: '2026-01-01T00:00:01.000Z' },
      { kind: 'step_result_accepted', run_id: 'run_001', at: '2026-01-01T00:00:02.000Z' },
      { kind: 'decision_applied', run_id: 'run_001', at: '2026-01-01T00:00:03.000Z' },
      { kind: 'run_terminated', run_id: 'run_001', at: '2026-01-01T00:00:04.000Z' },
    ];
    await Promise.all(events.map((e) => sink.emit(e)));

    const content = await readFile(filePath, 'utf-8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(JSON.parse(lines[i]!).kind).toBe(events[i]!.kind);
    }
  });

  test('write failure propagates as rejection', async () => {
    const sink = new JsonlEventSink({ filePath: '/nonexistent/dir/events.jsonl' });
    const event: RuntimeEvent = {
      kind: 'run_started',
      run_id: 'run_001',
      at: '2026-01-01T00:00:00.000Z',
    };
    try {
      await sink.emit(event);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  test('event with details is written correctly', async () => {
    const sink = new JsonlEventSink({ filePath });
    const event: RuntimeEvent = {
      kind: 'step_result_accepted',
      run_id: 'run_001',
      at: '2026-01-01T00:00:00.000Z',
      details: { step_id: 'step_a', attempt: 1, status: 'success' },
    };
    await sink.emit(event);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content.trimEnd());
    expect(parsed.kind).toBe('step_result_accepted');
    expect(parsed.details.step_id).toBe('step_a');
  });
});
