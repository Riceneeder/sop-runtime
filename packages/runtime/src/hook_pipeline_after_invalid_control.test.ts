import {describe, expect, test} from 'bun:test';
import {
  AfterStepHook,
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  FixedClock,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — afterStep invalid hook return boundary', () => {
  const invalidControlCases: {
    name: string;
    hook: () => { control: unknown };
  }[] = [
    {
      'name': 'rejects unknown action',
      'hook': () => ({ 'control': { 'action': 'unknown_action' } }),
    },
    {
      'name': 'rejects pause with non-string reason',
      'hook': () => ({ 'control': { 'action': 'pause', 'reason': 123 } }),
    },
    {
      'name': 'rejects terminate with invalid runStatus',
      'hook': () => ({ 'control': { 'action': 'terminate', 'runStatus': 'succeeded', 'reason': 'done' } }),
    },
  ];

  for (const scenario of invalidControlCases) {
    test(`afterStep invalid control: ${scenario.name} (EXTERNAL BOUNDARY)`, async () => {
      const store = new InMemoryStateStore();
      const host = new RuntimeHost({
        store,
        'decisionProvider': new DefaultDecisionProvider(),
        'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
        'idGenerator': new SequentialIdGenerator(),
        'hooks': {
          'afterStep': [scenario.hook as unknown as AfterStepHook],
        },
      });
      host.registerExecutor('tool', 'default_tool', (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'ok' },
      }));

      const started = await host.startRun({
        'definition': buildDefinition(),
        'input': { 'company': 'Acme' },
      });

      let runtimeError: unknown;
      try {
        await host.runReadyStep({
          'definition': buildDefinition(),
          'runId': started.state.run_id,
        });
      } catch (caught) {
        runtimeError = caught;
      }

      expect(runtimeError).toBeInstanceOf(RuntimeError);
      const err = runtimeError as RuntimeError;
      expect(err.code).toBe('hook_rejected');
      expect(err.details?.stage).toBe('afterStep');
      expect(err.details?.index).toBe(0);

      const storedState = await store.loadRun(started.state.run_id);
      expect(storedState?.accepted_results.step_a).toBeUndefined();
    });
  }
});
