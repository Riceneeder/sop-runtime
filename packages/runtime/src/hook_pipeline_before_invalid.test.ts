import { describe, expect, test } from 'bun:test';
import {
  BeforeStepHook,
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  expectRuntimeErrorCode,
  FixedClock,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — beforeStep invalid', () => {
  test('beforeStep rejects unknown top-level hook fields', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return { 'inputs': { 'company': 'Acme' }, 'outcome_id': 'done' };
        }) as unknown as BeforeStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id }),
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
      'value': () => ({ 'company': 'Acme', 'callback': () => undefined }),
    },
    {
      'name': 'Date instances',
      'field': 'inputs',
      'value': () => ({ 'company': 'Acme', 'created_at': new Date('2026-04-20T12:00:00.000Z') }),
    },
    {
      'name': 'Map instances',
      'field': 'config',
      'value': () => ({ 'headers': new Map([['x-test', '1']]) }),
    },
    {
      'name': 'non-finite numbers',
      'field': 'config',
      'value': () => ({ 'limit': Infinity }),
    },
    {
      'name': 'undefined values',
      'field': 'config',
      'value': () => ({ 'maybe': undefined }),
    },
    {
      'name': 'cyclic references',
      'field': 'inputs',
      'value': () => {
        const value: Record<string, unknown> = { 'company': 'Acme' };
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
          'beforeStep': [(() => ({ [scenario.field]: scenario.value() })) as unknown as BeforeStepHook],
        },
      });
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      const error = await expectRuntimeErrorCode(
        () => host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id }),
        'hook_rejected',
      );

      expect(error.details?.field).toBe(scenario.field);
    });
  }
});
