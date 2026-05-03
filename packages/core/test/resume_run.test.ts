import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, createRun, pauseRun, resumeRun, applyStepResult} from '../src/index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'resume_test',
    'name': 'Resume Test',
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

function runAwaitingDecision(definition: SopDefinition) {
  const state = createRun({
    definition,
    'input': {'company': 'Acme'},
    'runId': 'run_001',
  });
  return applyStepResult({
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
}

describe('resumeRun', () => {
  test('resumes from paused ready back to ready', () => {
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

    const resumed = resumeRun({
      definition,
      'state': paused,
      'now': '2026-04-20T12:05:00Z',
    });

    expect(resumed.phase).toBe('ready');
    expect(resumed.pause).toBeUndefined();
    expect(resumed.current_step_id).toBe('step_a');
    expect(resumed.steps.step_a?.status).toBe('active');
    expect(resumed.history.at(-1)).toEqual({
      'kind': 'run_resumed',
      'previous_phase': 'ready',
      'at': '2026-04-20T12:05:00Z',
    });
  });

  test('resumes from paused awaiting_decision back to awaiting_decision', () => {
    const definition = buildDefinition();
    const state = runAwaitingDecision(definition);
    const paused = pauseRun({
      definition,
      state,
      'reason': 'review',
    });

    const resumed = resumeRun({
      definition,
      'state': paused,
      'now': '2026-04-20T12:35:00Z',
    });

    expect(resumed.phase).toBe('awaiting_decision');
    expect(resumed.pause).toBeUndefined();
    expect(resumed.steps.step_a?.status).toBe('waiting_decision');
    expect(resumed.history.at(-1)).toEqual({
      'kind': 'run_resumed',
      'previous_phase': 'awaiting_decision',
      'at': '2026-04-20T12:35:00Z',
    });
  });

  test('rejects resuming a run that is not paused', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      resumeRun({
        definition,
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects resuming a terminated run', () => {
    const definition = buildDefinition();
    const state = {
      ...createRun({
        definition,
        'input': {'company': 'Acme'},
        'runId': 'run_001',
      }),
      'phase': 'terminated' as const,
      'status': 'succeeded' as const,
    };

    let error: unknown;
    try {
      resumeRun({
        definition,
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects definition mismatch', () => {
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

    let error: unknown;
    try {
      resumeRun({
        'definition': {
          ...definition,
          'sop_id': 'other',
        },
        'state': paused,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });
});
