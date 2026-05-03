import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, createRun, pauseRun, terminateRun, applyStepResult} from '../src/index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'terminate_test',
    'name': 'Terminate Test',
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

describe('terminateRun', () => {
  test('terminates from ready phase with cancelled status', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    const terminated = terminateRun({
      definition,
      state,
      'runStatus': 'cancelled',
      'reason': 'operator cancelled',
      'now': '2026-04-20T12:00:00Z',
    });

    expect(terminated.status).toBe('cancelled');
    expect(terminated.phase).toBe('terminated');
    expect(terminated.current_step_id).toBeNull();
    expect(terminated.current_attempt).toBeNull();
    expect(terminated.terminal).toEqual({
      'run_status': 'cancelled',
      'reason': 'operator cancelled',
    });
    expect(terminated.steps.step_a?.status).toBe('failed');
    expect(terminated.history.at(-1)).toEqual({
      'kind': 'run_terminated',
      'run_status': 'cancelled',
      'reason': 'operator cancelled',
      'at': '2026-04-20T12:00:00Z',
    });
  });

  test('terminates from awaiting_decision phase with failed status', () => {
    const definition = buildDefinition();
    const state = runAwaitingDecision(definition);

    const terminated = terminateRun({
      definition,
      state,
      'runStatus': 'failed',
      'reason': 'timeout exceeded',
      'now': '2026-04-20T12:30:00Z',
    });

    expect(terminated.status).toBe('failed');
    expect(terminated.phase).toBe('terminated');
    expect(terminated.current_step_id).toBeNull();
    expect(terminated.current_attempt).toBeNull();
    expect(terminated.steps.step_a?.status).toBe('failed');
    expect(terminated.history.at(-1)).toEqual({
      'kind': 'run_terminated',
      'run_status': 'failed',
      'reason': 'timeout exceeded',
      'at': '2026-04-20T12:30:00Z',
    });
  });

  test('terminates from paused phase and marks active step as failed', () => {
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

    const terminated = terminateRun({
      definition,
      'state': paused,
      'runStatus': 'cancelled',
      'reason': 'abandoned',
      'now': '2026-04-20T12:10:00Z',
    });

    expect(terminated.status).toBe('cancelled');
    expect(terminated.phase).toBe('terminated');
    expect(terminated.pause).toBeUndefined();
    expect(terminated.steps.step_a?.status).toBe('failed');
    expect(terminated.history.at(-1)).toEqual({
      'kind': 'run_terminated',
      'run_status': 'cancelled',
      'reason': 'abandoned',
      'at': '2026-04-20T12:10:00Z',
    });
  });

  test('terminates from paused phase (paused from awaiting_decision) and marks step as failed', () => {
    const definition = buildDefinition();
    const state = runAwaitingDecision(definition);
    const paused = pauseRun({
      definition,
      state,
      'reason': 'inspect',
    });

    const terminated = terminateRun({
      definition,
      'state': paused,
      'runStatus': 'cancelled',
      'reason': 'abandoned',
      'now': '2026-04-20T12:10:00Z',
    });

    expect(terminated.status).toBe('cancelled');
    expect(terminated.phase).toBe('terminated');
    expect(terminated.pause).toBeUndefined();
    expect(terminated.steps.step_a?.status).toBe('failed');
    expect(terminated.history.at(-1)).toEqual({
      'kind': 'run_terminated',
      'run_status': 'cancelled',
      'reason': 'abandoned',
      'at': '2026-04-20T12:10:00Z',
    });
  });

  test('rejects terminating an already terminated run', () => {
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
      terminateRun({
        definition,
        state,
        'runStatus': 'cancelled',
        'reason': 'too late',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects terminating with succeeded status', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      terminateRun({
        definition,
        state,
        'runStatus': 'succeeded' as never,
        'reason': 'wrong',
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

    let error: unknown;
    try {
      terminateRun({
        'definition': {
          ...definition,
          'version': '9.9.9',
        },
        state,
        'runStatus': 'cancelled',
        'reason': 'bad',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });
});
