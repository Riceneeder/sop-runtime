import {describe, expect, test} from 'bun:test';
import {
  AfterStepHook,
  BeforeStepHook,
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  expectRuntimeErrorCode,
  FixedClock,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — invalid payloads', () => {
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
    expect((caught as Error).name).toBe('CoreError');
    expect((caught as Error).message).toContain('Step result artifacts must be a string map');
    const reloaded = await store.loadRun(started.state.run_id);
    expect(reloaded?.accepted_results.step_a).toBeUndefined();
  });

  test('afterStep oversized string output with preserve policy throws CoreError (not sandbox_error)', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_output_bytes = 20;
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'afterStep': [(() => {
          return {'result': {'output': 'x'.repeat(200)}};
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
    expect((caught as Error).name).toBe('CoreError');
    expect((caught as Error).message).toContain('Step result output must be a JSON object');
    const reloaded = await store.loadRun(started.state.run_id);
    expect(reloaded?.accepted_results.step_a).toBeUndefined();
  });

  test('afterStep circular output with preserve policy is not converted to sandbox_error', async () => {
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
