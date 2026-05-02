import {describe, expect, test} from 'bun:test';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  RecordingExecutor,
  RecordingEventSink,
  buildDefinition,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
  test('emits run_terminated events for normal terminal transitions', async () => {
    const eventSink = new RecordingEventSink();
    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': new RecordingExecutor(),
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      eventSink,
    });
    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': {'company': 'Acme'},
    });

    await host.runUntilComplete({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
    });

    expect(eventSink.events.map((event) => event.kind)).toContain('run_terminated');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_terminated',
      'run_id': 'run_001',
      'details': {
        'run_status': 'succeeded',
        'reason': 'complete',
      },
    });
  });
});
