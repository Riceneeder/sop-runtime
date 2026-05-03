import {describe, expect, test} from 'bun:test';
import {RunState, StepResult} from '@sop-runtime/definition';
import {
  ClaimRunStartResult,
  DecisionProvider,
  ExecutorResult,
  HookControl,
  BeforeStepHookInput,
  AfterStepHook,
  AfterStepHookInput,
  RunStartClaimReason,
  StateStore,
  StepExecutor,
} from './index.js';
import {buildDefinition} from './runtime_host_test_helpers.js';

describe('runtime ports', () => {
  test('StateStore contract — methods accept and return expected shapes', async () => {
    const minimalStore: StateStore = {
      async loadRun(_runId) { return null; },
      async saveRun(_state) {},
      async saveRunState(_state) {},
      async loadRunRecord(_runId) { return null; },
      async saveRunRecord(_record) {},
      async claimRunStart(_params) {
        return {
          'state': {} as RunState,
          'record': {
            'run_id': 'run_test',
            'sop_id': 'sop_a',
            'sop_version': '1.0.0',
            'idempotency_key': 'ik',
            'concurrency_key': 'ck',
          },
          'reason': 'created',
        } satisfies ClaimRunStartResult;
      },
      async findRunByIdempotencyKey(_lookup) { return null; },
      async findRunningRunByConcurrencyKey(_lookup) { return null; },
      async findLatestRunByConcurrencyKey(_lookup) { return null; },
    };

    expect(await minimalStore.loadRun('unknown_id')).toBeNull();
    const claimResult = await minimalStore.claimRunStart({
      'state': {
        'run_id': 'run_test',
        'sop_id': 'sop_a',
        'sop_version': '1.0.0',
        'status': 'running',
        'phase': 'ready',
        'run_input': {},
        'entry_step_id': 'step_a',
        'current_step_id': null,
        'current_attempt': null,
        'steps': {},
        'accepted_results': {},
        'history': [],
      },
      'record': {
        'run_id': 'run_test',
        'sop_id': 'sop_a',
        'sop_version': '1.0.0',
        'idempotency_key': 'ik',
        'concurrency_key': 'ck',
      },
      'concurrency_mode': 'allow_parallel',
      'cooldown_secs': 0,
      'now': '2026-01-01T00:00:00.000Z',
    });
    expect(claimResult.reason).toBe('created');
    expect(claimResult.record.run_id).toBe('run_test');
  });

  test('StepExecutor contract — returns valid ExecutorResult', async () => {
    const executor: StepExecutor = {
      async execute(_packet) {
        return {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'success',
          'output': {},
        } satisfies ExecutorResult;
      },
    };

    const result = await executor.execute({
      'run_id': 'run_001',
      'step_id': 'step_a',
      'attempt': 1,
      'inputs': {},
      'executor': {
        'kind': 'sandbox_tool',
        'name': 'demo_tool',
        'timeout_secs': 10,
        'allow_network': false,
        'env': {},
        'resource_limits': {'max_output_bytes': 1024, 'max_artifacts': 1},
      },
      'output_schema': {'type': 'object'},
    });
    expect(result.status).toBe('success');
    expect(result.run_id).toBe('run_001');
    expect(result.step_id).toBe('step_a');
    expect(result.attempt).toBe(1);
  });

  test('DecisionProvider contract — returns valid Decision with outcome_id', async () => {
    const decisionProvider: DecisionProvider = {
      async decide(_input) {
        return {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'default',
          'reason': 'automatic approval',
        };
      },
    };

    const decision = await decisionProvider.decide({} as never);
    expect(decision.outcome_id).toBe('default');
    expect(decision.run_id).toBe('run_001');
  });

  test('HookControl discriminated union — pause and terminate shapes', () => {
    const pause: HookControl = {'action': 'pause', 'reason': 'review'};
    const terminate: HookControl = {'action': 'terminate', 'runStatus': 'failed', 'reason': 'error'};

    expect(pause.action).toBe('pause');
    expect(terminate.action).toBe('terminate');
    expect(terminate.runStatus).toBe('failed');
  });

  test('BeforeStepHookInput shape — valid packet structure', () => {
    const input: BeforeStepHookInput = {
      'state': {
        'run_id': 'test',
        'sop_id': 'sop_test',
        'sop_version': '1.0.0',
        'status': 'running',
        'phase': 'ready',
        'run_input': {},
        'entry_step_id': 'step_a',
        'current_step_id': null,
        'current_attempt': null,
        'steps': {},
        'accepted_results': {},
        'history': [],
      },
      'definition': buildDefinition(),
      'packet': {
        'run_id': 'r1',
        'step_id': 's1',
        'attempt': 1,
        'inputs': {},
        'executor': {
          'kind': 'sandbox_tool',
          'name': 'demo_tool',
          'config': {},
          'timeout_secs': 10,
          'allow_network': false,
          'env': {},
          'resource_limits': {'max_output_bytes': 1024, 'max_artifacts': 1},
        },
      },
    };

    expect(input.packet.run_id).toBe('r1');
    expect(input.packet.executor.kind).toBe('sandbox_tool');
  });

  test('AfterStepHookInput and AfterStepHook — valid function contract', () => {
    const input: AfterStepHookInput = {
      'state': {
        'run_id': 'test',
        'sop_id': 'sop_test',
        'sop_version': '1.0.0',
        'status': 'running',
        'phase': 'ready',
        'run_input': {},
        'entry_step_id': 'step_a',
        'current_step_id': null,
        'current_attempt': null,
        'steps': {},
        'accepted_results': {},
        'history': [],
      },
      'definition': buildDefinition(),
      'result': {
        'run_id': 'r1', 'step_id': 's1', 'attempt': 1, 'status': 'success', 'output': {},
      } satisfies StepResult,
      'packet': {
        'run_id': 'r1',
        'step_id': 's1',
        'attempt': 1,
        'inputs': {},
        'executor': {
          'kind': 'sandbox_tool',
          'name': 'demo_tool',
          'config': {},
          'timeout_secs': 10,
          'allow_network': false,
          'env': {},
          'resource_limits': {'max_output_bytes': 1024, 'max_artifacts': 1},
        },
      },
    };

    const hook: AfterStepHook = () => ({
      'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop'},
    });

    const hookResult = hook(input);
    expect(hookResult).toEqual({
      'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop'},
    });
  });

  test('ExecutorResult — error result shape with artifacts and metrics', () => {
    const executorResult: ExecutorResult = {
      'run_id': 'run_001',
      'step_id': 'search_news',
      'attempt': 1,
      'status': 'tool_error',
      'artifacts': {
        'stderr': '/tmp/stderr.txt',
      },
      'error': {
        'code': 'tool_error',
        'message': 'Search failed.',
      },
      'metrics': {
        'elapsed_ms': 1200,
      },
    };

    expect(executorResult.status).toBe('tool_error');
    expect(executorResult.artifacts?.stderr).toBe('/tmp/stderr.txt');
    expect(executorResult.error?.code).toBe('tool_error');
  });

  test('RunStartClaimReason union constraint', () => {
    const reasons: RunStartClaimReason[] = [
      'created',
      'idempotent_replay',
      'singleflight_joined',
      'dropped_running',
      'cooldown_active',
    ];

    expect(reasons).toContain('created');
    expect(reasons).toHaveLength(5);
  });
});
