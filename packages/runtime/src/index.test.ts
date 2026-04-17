import {describe, expect, test} from 'bun:test';
import {DecisionProvider, ExecutorResult, StateStore, StepExecutor} from './index';

describe('runtime ports', () => {
  test('exports storage, executor, and decision contracts', () => {
    const stateStore = {} as StateStore;
    const stepExecutor = {} as StepExecutor;
    const decisionProvider = {} as DecisionProvider;
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
    expect(executorResult.artifacts?.stderr).toBe('/tmp/stderr.txt');
  });
});
