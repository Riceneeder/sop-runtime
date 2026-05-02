import {describe, expect, test} from 'bun:test';
import {AcceptedStepResult, JsonObject, StepResult} from '@sop-runtime/definition';
import {
  BeforeStepHook,
  AfterStepHook,
  DefaultDecisionProvider,
  ExecutorHandler,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  buildDefinitionWithExecutor,
  expectRuntimeErrorCode,
  FixedClock,
  PacketSnapshot,
  RecordingEventSink,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline', () => {
  test('beforeStep can rewrite inputs and executor receives them', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          return {
            'inputs': {...input.packet.inputs as JsonObject, 'company': 'Rewritten'},
          };
        }],
      },
    });
    let receivedInputs: JsonObject = {};
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedInputs = input.packet.inputs;
      return {
        'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
        'attempt': input.packet.attempt, 'status': 'success',
        'output': {'summary': 'ok'},
      };
    });

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(receivedInputs.company).toBe('Rewritten');
  });

  test('beforeStep can rewrite executor config and handler receives it', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          return {
            'config': {...(input.packet.executor.config as JsonObject ?? {}), 'command_template': 'rewritten_cmd'},
          };
        }],
      },
    });
    let receivedConfig: JsonObject = {};
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedConfig = input.config;
      return {
        'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
        'attempt': input.packet.attempt, 'status': 'success',
        'output': {'summary': 'ok'},
      };
    });

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(receivedConfig.command_template).toBe('rewritten_cmd');
  });

  test('hook mutations to definition do not affect core state transitions or output validation', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          const step = input.definition.steps[0]!;
          step.output_schema = {
            'type': 'object',
            'required': ['missing'],
            'properties': {'missing': {'type': 'string'}},
          };
          step.supervision.allowed_outcomes = [{'id': 'mutated', 'description': 'mutated'}];
          step.supervision.default_outcome = 'mutated';
          step.transitions = {
            'mutated': {
              'terminate': {
                'run_status': 'failed',
                'reason': 'mutated definition leaked',
              },
            },
          };
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {'summary': 'still valid'},
      'artifacts': {'report_md': '/tmp/still-valid.md'},
    }));

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    const completed = await host.runUntilComplete({definition, 'runId': started.state.run_id});

    expect(completed.state.status).toBe('succeeded');
    expect(completed.final_output?.summary).toBe('still valid');
  });

  test('hook mutations to packet executor internals do not affect executor dispatch', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinitionWithExecutor({
      'config': {'command_template': 'run', 'path': '/tmp'},
      'env': {'TOKEN': 'original'},
      'resource_limits': {
        'max_output_bytes': 2048,
        'max_artifacts': 2,
      },
    });
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          input.packet.executor.env.TOKEN = 'mutated';
          input.packet.executor.resource_limits.max_output_bytes = 1;
          const config = input.packet.executor.config;
          if (config !== undefined) {
            config.command_template = 'mutated';
          }
        }],
        'afterStep': [(input) => {
          input.packet.executor.env.TOKEN = 'mutated_after';
          input.packet.executor.resource_limits.max_artifacts = 99;
        }],
      },
    });
    const receivedExecutors: PacketSnapshot['executor'][] = [];
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedExecutors.push(input.packet.executor);
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': {'summary': 'ok'},
      };
    });

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    await host.runReadyStep({definition, 'runId': started.state.run_id});

    const receivedExecutor = receivedExecutors[0];
    expect(receivedExecutor?.config?.command_template).toBe('run');
    expect(receivedExecutor?.env.TOKEN).toBe('original');
    expect(receivedExecutor?.resource_limits.max_output_bytes).toBe(2048);
    expect(receivedExecutor?.resource_limits.max_artifacts).toBe(2);
  });

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
          return {'control': {'action': 'pause', 'reason': 'review required'}};
        }],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return {'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {}};
    });

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

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
          return {'control': {'action': 'terminate', 'runStatus': 'cancelled', 'reason': 'no longer needed'}};
        }],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return {'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {}};
    });

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('cancelled');
    expect(state.terminal?.reason).toBe('no longer needed');
    expect(eventSink.events.map((e) => e.kind)).toContain('run_terminated');
  });

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

  test('invalid hook control throws hook_rejected', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return {control: {action: 'unknown_action'}};
        }) as unknown as BeforeStepHook],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});

    let hookError: unknown;
    try {
      await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});
    } catch (caught) {
      hookError = caught;
    }

    expect(hookError).toBeInstanceOf(RuntimeError);
    expect((hookError as RuntimeError).code).toBe('hook_rejected');
  });

  test('beforeStep rejects unknown top-level hook fields', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return {'inputs': {'company': 'Acme'}, 'outcome_id': 'done'};
        }) as unknown as BeforeStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id}),
      'hook_rejected',
    );

    expect(error.details?.field).toBe('outcome_id');
  });

  test('afterStep rejects state-machine fields at the top level', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [(() => {
          return {'result': {'output': {'summary': 'ok'}}, 'next_step': 'step_b'};
        }) as unknown as AfterStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id}),
      'hook_rejected',
    );

    expect(error.details?.field).toBe('next_step');
  });

  test('afterStep rejects unknown fields inside result patches', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [(() => {
          return {'result': {'output': {'summary': 'ok'}, 'state': {'phase': 'terminated'}}};
        }) as unknown as AfterStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id}),
      'hook_rejected',
    );

    expect(error.details?.field).toBe('state');
  });

  const nonJsonSafeHookValues: {
    name: string;
    field: 'inputs' | 'config';
    value: () => unknown;
  }[] = [
    {
      'name': 'function values',
      'field': 'inputs',
      'value': () => ({'company': 'Acme', 'callback': () => undefined}),
    },
    {
      'name': 'Date instances',
      'field': 'inputs',
      'value': () => ({'company': 'Acme', 'created_at': new Date('2026-04-20T12:00:00.000Z')}),
    },
    {
      'name': 'Map instances',
      'field': 'config',
      'value': () => ({'headers': new Map([['x-test', '1']])}),
    },
    {
      'name': 'non-finite numbers',
      'field': 'config',
      'value': () => ({'limit': Infinity}),
    },
    {
      'name': 'undefined values',
      'field': 'config',
      'value': () => ({'maybe': undefined}),
    },
    {
      'name': 'cyclic references',
      'field': 'inputs',
      'value': () => {
        const value: Record<string, unknown> = {'company': 'Acme'};
        value.self = value;
        return value;
      },
    },
  ];

  for (const scenario of nonJsonSafeHookValues) {
    test(`beforeStep rejects non JSON-safe ${scenario.field}: ${scenario.name}`, async () => {
      const store = new InMemoryStateStore();
      const host = new RuntimeHost({
        store,
        'decisionProvider': new DefaultDecisionProvider(),
        'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
        'idGenerator': new SequentialIdGenerator(),
        'hooks': {
          'beforeStep': [(() => ({[scenario.field]: scenario.value()})) as unknown as BeforeStepHook],
        },
      });
      registerDefaultExecutor(host);

      const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
      const error = await expectRuntimeErrorCode(
        () => host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id}),
        'hook_rejected',
      );

      expect(error.details?.field).toBe(scenario.field);
    });
  }

  test('hook that throws produces hook_rejected with stage and index details', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [() => {
          throw new Error('hook panic');
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});

    let hookError: unknown;
    try {
      await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});
    } catch (caught) {
      hookError = caught;
    }

    expect(hookError).toBeInstanceOf(RuntimeError);
    expect((hookError as RuntimeError).code).toBe('hook_rejected');
    expect((hookError as RuntimeError).details).toMatchObject({
      'stage': 'afterStep',
      'index': 0,
      'error': 'hook panic',
    });
  });

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

  test('deadline after beforeStep hooks takes precedence over hook control', async () => {
    const clock = new FixedClock('2026-04-20T12:00:00.000Z');
    const definition = buildDefinition({'max_run_secs': 1});
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      clock,
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [() => {
          clock.setNow('2026-04-20T12:00:02.000Z');
          return {'control': {'action': 'pause', 'reason': 'hook pause'}};
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
        'output': {'summary': 'too late'},
      };
    });

    const started = await host.startRun({definition, 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({definition, 'runId': started.state.run_id});

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('failed');
    expect(state.terminal?.reason).toBe('max_run_secs_exceeded');
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

  test('multiple beforeStep hooks both returning control - last one wins', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [
          () => ({'control': {'action': 'pause', 'reason': 'first hook pause'}}),
          () => ({'control': {'action': 'terminate', 'runStatus': 'cancelled', 'reason': 'second hook terminate'}}),
        ],
      },
    });
    let executorCalled = false;
    host.registerExecutor('tool', 'default_tool', () => {
      executorCalled = true;
      return {'run_id': '', 'step_id': '', 'attempt': 0, 'status': 'success', 'output': {}};
    });

    const started = await host.startRun({'definition': buildDefinition(), 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': buildDefinition(), 'runId': started.state.run_id});

    expect(executorCalled).toBe(false);
    expect(state.phase).toBe('terminated');
    expect(state.status).toBe('cancelled');
    expect(state.terminal?.reason).toBe('second hook terminate');
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

  test('afterStep non-record artifacts with preserve policy throws CoreError (not sandbox_error)', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_artifacts = 1;
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [(() => {
          return {'result': {'artifacts': ['a', 'b']}};
        }) as unknown as AfterStepHook],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': definition, 'input': {'company': 'Acme'}});

    let caught: unknown;
    try {
      await host.runReadyStep({'definition': definition, 'runId': started.state.run_id});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const reloaded = await store.loadRun(started.state.run_id);
    expect(reloaded?.accepted_results.step_a).toBeUndefined();
  });

  test('afterStep non-JSON-safe output with preserve policy throws error (not sandbox_error)', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_output_bytes = 5000;
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [(() => {
          const circular: Record<string, unknown> = {};
          circular.self = circular;
          return {'result': {'output': circular}};
        }) as unknown as AfterStepHook],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
      'attempt': input.packet.attempt, 'status': 'success',
      'output': {'summary': 'ok'},
    }));

    const started = await host.startRun({'definition': definition, 'input': {'company': 'Acme'}});

    let caught: unknown;
    try {
      await host.runReadyStep({'definition': definition, 'runId': started.state.run_id});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const reloaded = await store.loadRun(started.state.run_id);
    expect(reloaded?.accepted_results.step_a).toBeUndefined();
  });
});
