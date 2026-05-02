import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, createRun, pauseRun, applyStepResult, getCurrentStep} from './index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'pause_step_test',
    'name': 'Pause Step Test',
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
        'kind': 'tool',
        'name': 'tool',
        'config': {'command_template': 'run'},
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
        'properties': {'summary': {'type': 'string'}},
      },
      'retry_policy': {
        'max_attempts': 2,
        'backoff_secs': [],
        'retry_on': ['tool_error'],
      },
      'supervision': {
        'owner': 'main_agent',
        'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
        'default_outcome': 'done',
      },
      'transitions': {
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

describe('getCurrentStep with paused runs', () => {
  test('paused from ready returns step with active status', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    const paused = pauseRun({
      definition,
      state,
      'reason': 'manual inspection',
      'now': '2026-04-20T12:00:00Z',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.previous_phase).toBe('ready');

    const view = getCurrentStep({definition, 'state': paused});

    expect(view).not.toBeNull();
    expect(view!.step_id).toBe('step_a');
    expect(view!.attempt).toBe(1);
    expect(view!.step_state.status).toBe('active');
  });

  test('paused from awaiting_decision returns step with waiting_decision status', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    const awaitingDecision = applyStepResult({
      definition,
      state,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'summary': 'ok'},
      },
    });

    const paused = pauseRun({
      definition,
      'state': awaitingDecision,
      'reason': 'review needed',
      'now': '2026-04-20T12:30:00Z',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.previous_phase).toBe('awaiting_decision');

    const view = getCurrentStep({definition, 'state': paused});

    expect(view).not.toBeNull();
    expect(view!.step_id).toBe('step_a');
    expect(view!.attempt).toBe(1);
    expect(view!.step_state.status).toBe('waiting_decision');
  });

  test('paused run without previous_phase throws invalid_state', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    const paused = pauseRun({
      definition,
      state,
      'reason': 'inspect',
    });

    const corrupted = {
      ...paused,
      'pause': undefined,
    };

    let error: unknown;
    try {
      getCurrentStep({definition, 'state': corrupted});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });
});
