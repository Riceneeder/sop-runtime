import {describe, expect, test} from 'bun:test';
import {
  CoreError,
  ClaimRunStartParams,
  ClaimRunStartResult,
  DecisionProvider,
  ExecutorResult,
  HookControl,
  BeforeStepHookInput,
  AfterStepHook,
  AfterStepHookInput,
  RuntimeStepPacket,
  RuntimeHostOptions,
  RunStartClaimReason,
  StateStore,
  StepExecutor,
} from './index.js';

describe('runtime ports', () => {
  test('exports storage, executor, and decision contracts', () => {
    const stateStore = {} as StateStore;
    const stepExecutor = {} as StepExecutor;
    const decisionProvider = {} as DecisionProvider;
    const packet = {} as RuntimeStepPacket;
    const claimParams = {} as ClaimRunStartParams;
    const claimResult = {} as ClaimRunStartResult;
    const startReason: RunStartClaimReason = 'created';
    const hookControl: HookControl = {'action': 'pause', 'reason': 'review'};
    const beforeInput = {} as BeforeStepHookInput;
    const afterInput = {} as AfterStepHookInput;
    const afterHook: AfterStepHook = () => ({'control': {'action': 'terminate', 'runStatus': 'failed', 'reason': 'stop'}});
    const hostOptions = {} as RuntimeHostOptions;
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

    expect(stateStore).toBeDefined();
    expect(stepExecutor).toBeDefined();
    expect(decisionProvider).toBeDefined();
    expect(packet).toBeDefined();
    expect(claimParams).toBeDefined();
    expect(claimResult).toBeDefined();
    expect(startReason).toBe('created');
    expect(hookControl.action).toBe('pause');
    expect(beforeInput).toBeDefined();
    expect(afterInput).toBeDefined();
    expect(afterHook).toBeDefined();
    expect(hostOptions).toBeDefined();
    expect(CoreError).toBeDefined();
    expect(executorResult.artifacts?.stderr).toBe('/tmp/stderr.txt');
  });
});
