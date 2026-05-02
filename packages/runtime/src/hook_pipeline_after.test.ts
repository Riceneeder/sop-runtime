import {describe, expect, test} from 'bun:test';
import {AcceptedStepResult, StepResult} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  ExecutorHandler,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  FixedClock,
  RecordingEventSink,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — afterStep', () => {
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

  const afterStepControlCases: {
    name: string;
    executorResult: (input: Parameters<ExecutorHandler>[0]) => StepResult;
    expectedAcceptedStatus: AcceptedStepResult['status'];
    control: {action: 'pause'; reason: string} | {action: 'terminate'; runStatus: 'failed'; reason: string};
  }[] = [
    {
      'name': 'pauses after accepted tool_error',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'tool_error',
        'error': {'code': 'tool_error', 'message': 'tool failed'},
      }),
      'expectedAcceptedStatus': 'tool_error',
      'control': {'action': 'pause', 'reason': 'review tool error'},
    },
    {
      'name': 'terminates after accepted tool_error',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'tool_error',
        'error': {'code': 'tool_error', 'message': 'tool failed'},
      }),
      'expectedAcceptedStatus': 'tool_error',
      'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop on tool error'},
    },
    {
      'name': 'pauses after accepted timeout',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'timeout',
        'error': {'code': 'timeout', 'message': 'timed out'},
      }),
      'expectedAcceptedStatus': 'timeout',
      'control': {'action': 'pause', 'reason': 'review timeout'},
    },
    {
      'name': 'terminates after accepted timeout',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'timeout',
        'error': {'code': 'timeout', 'message': 'timed out'},
      }),
      'expectedAcceptedStatus': 'timeout',
      'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop on timeout'},
    },
    {
      'name': 'pauses after normalized invalid_output',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': {'no_summary_here': true},
      }),
      'expectedAcceptedStatus': 'invalid_output',
      'control': {'action': 'pause', 'reason': 'review invalid output'},
    },
    {
      'name': 'terminates after normalized invalid_output',
      'executorResult': (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': {'no_summary_here': true},
      }),
      'expectedAcceptedStatus': 'invalid_output',
      'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop on invalid output'},
    },
  ];

  for (const scenario of afterStepControlCases) {
    test(`afterStep control ${scenario.name}`, async () => {
      const store = new InMemoryStateStore();
      const host = new RuntimeHost({
        store,
        'decisionProvider': new DefaultDecisionProvider(),
        'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
        'idGenerator': new SequentialIdGenerator(),
        'hooks': {
          'afterStep': [() => ({'control': scenario.control})],
        },
      });
      host.registerExecutor('tool', 'default_tool', scenario.executorResult);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

      expect(state.accepted_results.step_a?.status).toBe(scenario.expectedAcceptedStatus);
      if (scenario.control.action === 'pause') {
        expect(state.phase).toBe('paused');
        expect(state.pause?.previous_phase).toBe('awaiting_decision');
        expect(state.pause?.reason).toBe(scenario.control.reason);
      } else {
        expect(state.phase).toBe('terminated');
        expect(state.status).toBe('failed');
        expect(state.terminal?.reason).toBe(scenario.control.reason);
      }
    });
  }

  test('afterStep pause pauses the run from awaiting_decision', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'control': {'action': 'pause', 'reason': 'manual review after step'}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(state.phase).toBe('paused');
    expect(state.pause?.reason).toBe('manual review after step');
    expect(state.pause?.previous_phase).toBe('awaiting_decision');
  });

  test('afterStep terminate terminates from awaiting_decision', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          return {'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'step output invalid'}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('step output invalid');
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

  test('deadline after afterStep hooks takes precedence over result persistence and hook control', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          clock.setNow('2026-04-20T12:00:02.000Z');
          return {'control': {'action': 'terminate', 'runStatus': 'cancelled', 'reason': 'hook terminate'}};
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {'summary': 'too late'},
    }));

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({definition, 'runId': started.state.run_id});

    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('max_run_secs_exceeded');
    expect(state.accepted_results.step_a).toBeUndefined();
  });

  test('multiple afterStep hooks both returning control - last one wins after core acceptance', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [
          () => ({'control': {'action': 'pause', 'reason': 'first hook pause'}}),
          () => ({'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'second hook terminate'}}),
        ],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(state.accepted_results.step_a).toBeDefined();
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('second hook terminate');
  });
});
