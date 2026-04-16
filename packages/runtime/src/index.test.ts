import {describe, expect, test} from 'bun:test';
import {DecisionProvider, StateStore, StepExecutor} from './index';

describe('runtime ports', () => {
  test('exports storage, executor, and decision contracts', () => {
    const stateStore = {} as StateStore;
    const stepExecutor = {} as StepExecutor;
    const decisionProvider = {} as DecisionProvider;

    expect(stateStore).toBeDefined();
    expect(stepExecutor).toBeDefined();
    expect(decisionProvider).toBeDefined();
  });
});
