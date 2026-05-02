import { describe, expect, test } from 'bun:test';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  FixedClock,
  RecordingEventSink,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — beforeStep control', () => {
  test('beforeStep pause skips executor, saves paused state, emits run_paused', async () => {
    const eventSink = new RecordingEventSink();
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      eventSink,
      'hooks': {
        'beforeStep': [() => {
          return { 'control': { 'action': 'pause', 'reason': 'review required' } };
        }],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return { 'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {} };
    });

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const state = await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('paused');
    expect(state.pause?.reason).toBe('review required');
    expect(eventSink.events.map((e) => e.kind)).toContain('run_paused');
  });

  test('beforeStep terminate skips executor, saves terminated state, emits run_terminated', async () => {
    const eventSink = new RecordingEventSink();
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      eventSink,
      'hooks': {
        'beforeStep': [() => {
          return { 'control': { 'action': 'terminate', 'runStatus': 'cancelled', 'reason': 'no longer needed' } };
        }],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return { 'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {} };
    });

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const state = await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('cancelled');
    expect(state.terminal?.reason).toBe('no longer needed');
    expect(eventSink.events.map((e) => e.kind)).toContain('run_terminated');
  });

  test('multiple beforeStep hooks both returning control - last one wins', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [
          () => ({ 'control': { 'action': 'pause', 'reason': 'first hook pause' } }),
          () => ({ 'control': { 'action': 'terminate', 'runStatus': 'cancelled', 'reason': 'second hook terminate' } }),
        ],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return { 'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {} };
    });

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const state = await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('cancelled');
    expect(state.terminal?.reason).toBe('second hook terminate');
  });

  test('deadline after beforeStep hooks takes precedence over hook control', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({ 'max_run_secs': 1 });
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [() => {
          clock.setNow('2026-04-20T12:00:02.000Z');
          return { 'control': { 'action': 'pause', 'reason': 'hook pause' } };
        }],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', (input) => {
      executorCalled = true;
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'too late' },
      };
    });

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    const state = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('max_run_secs_exceeded');
  });
});
