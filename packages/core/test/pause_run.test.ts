import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, createRun, pauseRun, applyStepResult} from '../src/index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'pause_test',
    'name': 'Pause Test',
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

describe('pauseRun', () => {
  test('pauses a run in ready phase', () => {
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
    expect(paused.status).toBe('running');
    expect(paused.current_step_id).toBe('step_a');
    expect(paused.current_attempt).toBe(1);
    expect(paused.steps.step_a?.status).toBe('active');
    expect(paused.pause).toEqual({
      'previous_phase': 'ready',
      'reason': 'manual inspection',
      'paused_at': '2026-04-20T12:00:00Z',
    });
    expect(paused.history.at(-1)).toEqual({
      'kind': 'run_paused',
      'reason': 'manual inspection',
      'at': '2026-04-20T12:00:00Z',
    });
  });

  test('pauses a run in awaiting_decision phase', () => {
    const definition = buildDefinition();
    const state = runAwaitingDecision(definition);

    const paused = pauseRun({
      definition,
      state,
      'reason': 'review needed',
      'now': '2026-04-20T12:30:00Z',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.previous_phase).toBe('awaiting_decision');
    expect(paused.steps.step_a?.status).toBe('waiting_decision');
    expect(paused.history.at(-1)).toEqual({
      'kind': 'run_paused',
      'reason': 'review needed',
      'at': '2026-04-20T12:30:00Z',
    });
  });

  test('rejects pausing a terminated run', () => {
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
      pauseRun({
        definition,
        state,
        'reason': 'too late',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects pausing an already paused run', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const paused = pauseRun({
      definition,
      state,
      'reason': 'first pause',
    });

    let error: unknown;
    try {
      pauseRun({
        definition,
        'state': paused,
        'reason': 'second pause',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects definition that does not match run', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      pauseRun({
        'definition': {
          ...definition,
          'version': '9.9.9',
        },
        state,
        'reason': 'bad',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });
});
