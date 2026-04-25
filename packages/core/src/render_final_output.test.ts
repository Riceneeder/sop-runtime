import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, applyDecision, applyStepResult, createRun, renderFinalOutput} from './index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'render_output',
    'name': 'Render Output',
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
      'inputs': {},
      'executor': {
        'kind': 'sandbox_tool',
        'tool': 'tool',
        'command_template': 'run',
        'path': '/tmp',
        'timeout_secs': 120,
        'allow_network': true,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
      'output_schema': {},
      'retry_policy': {
        'max_attempts': 1,
        'backoff_secs': [],
        'retry_on': [],
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
    'final_output': {
      'summary': '${steps.step_a.output.summary}',
      'artifact': '${steps.step_a.artifacts.report_md}',
      'company': '${coalesce(run.input.company, "unknown")}',
    },
  };
}

function buildTerminatedState() {
  const definition = buildDefinition();
  const created = createRun({
    definition,
    'input': {'company': 'Acme'},
    'runId': 'run_001',
  });
  const awaiting = applyStepResult({
    definition,
    'state': created,
    'stepResult': {
      'run_id': 'run_001',
      'step_id': 'step_a',
      'attempt': 1,
      'status': 'success',
      'output': {'summary': 'hello'},
      'artifacts': {'report_md': '/tmp/report.md'},
    },
  });

  return {
    definition,
    'state': applyDecision({
      definition,
      'state': awaiting,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'done',
      },
    }),
  };
}

describe('renderFinalOutput', () => {
  test('renders terminated output from accepted step results', () => {
    const {definition, state} = buildTerminatedState();

    expect(renderFinalOutput({
      definition,
      state,
    })).toEqual({
      'summary': 'hello',
      'artifact': '/tmp/report.md',
      'company': 'Acme',
    });
  });

  test('rejects non-terminated runs and missing direct references', () => {
    const definition = buildDefinition();
    const created = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let phaseError: unknown;
    try {
      renderFinalOutput({
        definition,
        'state': created,
      });
    } catch (caught) {
      phaseError = caught;
    }

    const awaiting = applyStepResult({
      definition,
      'state': created,
      'stepResult': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'status': 'success',
        'output': {'summary': 'hello'},
      },
    });
    const terminated = applyDecision({
      definition,
      'state': awaiting,
      'decision': {
        'run_id': 'run_001',
        'step_id': 'step_a',
        'attempt': 1,
        'outcome_id': 'done',
      },
    });

    let missingError: unknown;
    try {
      renderFinalOutput({
        definition,
        'state': terminated,
      });
    } catch (caught) {
      missingError = caught;
    }

    expect((phaseError as CoreError).code).toBe('invalid_state');
    expect((missingError as CoreError).code).toBe('expression_evaluation_failed');
  });

  test('rejects a definition that does not match the persisted run SOP id/version', () => {
    const {definition, state} = buildTerminatedState();

    let error: unknown;
    try {
      renderFinalOutput({
        'definition': {
          ...definition,
          'version': '2.1.0',
        },
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as CoreError).code).toBe('invalid_state');
  });
});
