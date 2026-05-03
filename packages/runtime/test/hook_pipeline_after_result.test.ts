import {describe, expect, test} from 'bun:test';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from '../src/index.js';
import {
  buildDefinition,
  FixedClock,
  RecordingEventSink,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — afterStep result', () => {
  test('afterStep can rewrite executor output and core accepts it', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'result': {'output': {'summary': 'rewritten by hook'}}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'original'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(state.accepted_results.step_a?.output).toEqual({'summary': 'rewritten by hook'});
  });

  test('afterStep oversized output is caught by resource_limits enforcement', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_output_bytes = 20;
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'result': {'output': {'summary': 'x'.repeat(200)}}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': definition, 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': definition, 'runId': started.state.run_id});

    expect(state.phase).toBe('awaiting_decision');
    expect(state.accepted_results.step_a?.status).toBe('sandbox_error');
    expect(state.accepted_results.step_a?.error?.code).toBe('max_output_bytes_exceeded');
    expect(state.accepted_results.step_a?.output).toBeUndefined();
  });

  test('afterStep extra artifacts are caught by resource_limits enforcement', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_artifacts = 1;
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'result': {'artifacts': {'a': '/tmp/a', 'b': '/tmp/b'}}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': definition, 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': definition, 'runId': started.state.run_id});

    expect(state.phase).toBe('awaiting_decision');
    expect(state.accepted_results.step_a?.status).toBe('sandbox_error');
    expect(state.accepted_results.step_a?.error?.code).toBe('max_artifacts_exceeded');
  });

  test('afterStep can rewrite result status to tool_error', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'result': {'status': 'tool_error', 'output': {'summary': 'error output'}}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'original'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(state.phase).toBe('awaiting_decision');
    const accepted = state.accepted_results.step_a;
    expect(accepted?.status).toBe('tool_error');
  });

  test('step_result_accepted event reports the normalized accepted status', async () => {
    const eventSink = new RecordingEventSink();
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      eventSink,
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {'no_summary_here': true},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});
    const acceptedEvent = eventSink.events.find((event) => event.kind === 'step_result_accepted');

    expect(state.accepted_results.step_a?.status).toBe('invalid_output');
    expect(acceptedEvent?.details?.status).toBe('invalid_output');
  });
});
