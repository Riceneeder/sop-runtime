import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, applyStepResult, createRun} from './index';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'apply_result',
    'name': 'Apply Result',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': {
        'company': {'type': 'string'},
      },
    },
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'key',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'key',
      },
    },
    'steps': [{
      'id': 'step_a',
      'title': 'A',
      'inputs': {'company': '${run.input.company}'},
      'executor': {
        'kind': 'sandbox_tool',
        'tool': 'web_search',
        'command_template': 'Search',
        'path': '/tmp',
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {
        'type': 'object',
        'required': ['summary'],
        'properties': {
          'summary': {'type': 'string'},
        },
        'additionalProperties': false,
      },
      'retry_policy': {
        'max_attempts': 2,
        'backoff_secs': [],
        'retry_on': ['tool_error'],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [
          {'id': 'retry', 'description': 'retry'},
          {'id': 'done', 'description': 'done'},
        ],
        'default_outcome': 'done',
      },
      'transitions': {
        'retry': {'next_step': 'step_a'},
        'done': {
          'terminate': {
            'run_status': 'succeeded',
            'reason': 'complete',
          },
        },
      },
    }],
    'final_output': {'ok': true},
  };
}

describe('applyStepResult', () => {
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
