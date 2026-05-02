import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {applyStepResult, createRun} from './index.js';
import {buildDefinition} from './apply_step_result_test_helpers.js';

describe('applyStepResult normalization', () => {
  test('accepts a matching success result and moves the run to awaiting_decision', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const nextState = applyStepResult({
      definition,
      state,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'summary': 'ok'},
      },
      'now': '2026-04-20T12:10:00Z',
    });

    expect(nextState.phase).toBe('awaiting_decision');
    expect(nextState.steps.step_a?.status).toBe('waiting_decision');
    expect(nextState.steps.step_a?.last_result_status).toBe('success');
    expect(nextState.accepted_results.step_a?.status).toBe('success');
    expect(nextState.updated_at).toBe('2026-04-20T12:10:00Z');
  });

  test('normalizes invalid success output into invalid_output', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const nextState = applyStepResult({
      definition,
      state,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'wrong': 'shape'} as never,
      },
    });

    expect(nextState.accepted_results.step_a?.status).toBe('invalid_output');
    expect(nextState.accepted_results.step_a?.error?.code).toBe('invalid_output');
  });

  test('normalizes missing success output into invalid_output even with permissive schema', () => {
    const baseDefinition = buildDefinition();
    const definition: SopDefinition = {
      ...baseDefinition,
      'steps': [{
        ...baseDefinition.steps[0]!,
        'output_schema': {},
      }],
    };
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const nextState = applyStepResult({
      definition,
      state,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
      },
    });

    expect(nextState.accepted_results.step_a?.status).toBe('invalid_output');
    expect(nextState.accepted_results.step_a?.error?.code).toBe('invalid_output');
    expect(nextState.steps.step_a?.last_result_status).toBe('invalid_output');
  });

  test('only keeps accepted output for schema-valid success results', () => {
    const definition = buildDefinition();
    const toolErrorState = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const failedAccepted = applyStepResult({
      definition,
      'state': toolErrorState,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'tool_error',
        'output': {'summary': 'should_not_leak'} as never,
      },
    });

    expect(failedAccepted.accepted_results.step_a?.status).toBe('tool_error');
    expect(failedAccepted.accepted_results.step_a?.output).toBeUndefined();

    const invalidOutputState = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_002',
    });
    const invalidAccepted = applyStepResult({
      definition,
      'state': invalidOutputState,
      'stepResult': {
        'run_id': 'run_002',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'wrong': 'shape'} as never,
      },
    });

    expect(invalidAccepted.accepted_results.step_a?.status).toBe('invalid_output');
    expect(invalidAccepted.accepted_results.step_a?.output).toBeUndefined();
  });
});
