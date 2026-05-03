import { describe, expect, test } from 'bun:test';
import {
  BeforeStepHook,
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from '../src/index.js';
import {
  buildDefinition,
  expectRuntimeErrorCode,
  FixedClock,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — beforeStep invalid hook return boundary', () => {
  test('beforeStep rejects state-machine field outcome_id at top level (EXTERNAL BOUNDARY)', async () => {
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

  test('beforeStep rejects state-machine field next_step at top level (EXTERNAL BOUNDARY)', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return { 'inputs': { 'company': 'Acme' }, 'next_step': 'step_b' };
        }) as unknown as BeforeStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id }),
      'hook_rejected',
    );

    expect(error.details?.field).toBe('next_step');
  });

  test('beforeStep rejects state-machine field transition at top level (EXTERNAL BOUNDARY)', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return { 'inputs': { 'company': 'Acme' }, 'transition': 'done' };
        }) as unknown as BeforeStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id }),
      'hook_rejected',
    );

    expect(error.details?.field).toBe('transition');
  });

  test('beforeStep rejects state-machine field state at top level (EXTERNAL BOUNDARY)', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(() => {
          return { 'inputs': { 'company': 'Acme' }, 'state': { 'phase': 'terminated' } };
        }) as unknown as BeforeStepHook],
      },
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const error = await expectRuntimeErrorCode(
      () => host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id }),
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
