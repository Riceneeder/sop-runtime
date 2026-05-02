import {describe, expect, test} from 'bun:test';
import {JsonObject} from '@sop-runtime/definition';
import {
  BeforeStepHook,
  DefaultDecisionProvider,
  InMemoryStateStore,
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

describe('hook pipeline — beforeStep', () => {
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
});
