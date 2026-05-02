import {describe, expect, test} from 'bun:test';
import {CoreError, applyStepResult, createRun} from './index.js';
import {buildDefinition} from './apply_step_result_test_helpers.js';

describe('applyStepResult validation', () => {
  test('rejects stale attempts and unexpected fields', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let staleError: unknown;
    try {
      applyStepResult({
        definition,
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 2,
          'status': 'tool_error',
        },
      });
    } catch (caught) {
      staleError = caught;
    }

    let extraFieldError: unknown;
    try {
      applyStepResult({
        definition,
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'tool_error',
          'extra': true,
        } as never,
      });
    } catch (caught) {
      extraFieldError = caught;
    }

    expect((staleError as CoreError).code).toBe('step_result_rejected');
    expect((extraFieldError as CoreError).code).toBe('step_result_rejected');
  });

  test('rejects a definition that does not match the persisted run SOP id/version', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      applyStepResult({
        'definition': {
          ...definition,
          'version': '2.0.0',
        },
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'tool_error',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects non-plain objects in executor payload fields', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    class OutputPayload {
      summary = 'bad';
    }

    let outputError: unknown;
    try {
      applyStepResult({
        definition,
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'tool_error',
          'output': new OutputPayload(),
        } as never,
      });
    } catch (caught) {
      outputError = caught;
    }

    let metricsError: unknown;
    try {
      applyStepResult({
        definition,
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'tool_error',
          'metrics': {'started_at': new Date()},
        } as never,
      });
    } catch (caught) {
      metricsError = caught;
    }

    expect((outputError as CoreError).code).toBe('step_result_rejected');
    expect((metricsError as CoreError).code).toBe('step_result_rejected');
  });

  test('rejects results when the run is not ready', () => {
    const definition = buildDefinition();
    const readyState = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const state = {
      ...readyState,
      'phase': 'awaiting_decision' as const,
      'steps': {
        ...readyState.steps,
        'step_a': {
          ...readyState.steps.step_a!,
          'status': 'waiting_decision' as const,
        },
      },
    };

    let error: unknown;
    try {
      applyStepResult({
        definition,
        state,
        'stepResult': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'status': 'tool_error',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as CoreError).code).toBe('invalid_state');
  });
});
