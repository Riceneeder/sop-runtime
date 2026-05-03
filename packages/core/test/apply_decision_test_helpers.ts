import {ExecutorConfig, RetryableStepResultStatus, SopDefinition} from '@sop-runtime/definition';
import {applyStepResult, createRun} from '../src/index.js';

function buildPolicies() {
  return {
    'cooldown_secs': 0,
    'max_run_secs': 60,
    'idempotency_key_template': 'key',
    'concurrency': {
      'mode': 'singleflight' as const,
      'key_template': 'key',
    },
  };
}

function buildExecutor(overrides?: Partial<ExecutorConfig>): ExecutorConfig {
  return {
    'kind': 'tool',
    'name': 'tool',
    'config': {'command_template': 'run', 'path': '/tmp'},
    'timeout_secs': 120,
    'allow_network': true,
    'env': {},
    'resource_limits': {
      'max_output_bytes': 1024,
      'max_artifacts': 1,
    },
    ...overrides,
  };
}

function buildStepA() {
  return {
    'id': 'step_a',
    'title': 'A',
    'inputs': {},
    'executor': buildExecutor(),
    'output_schema': {
      'type': 'object',
      'required': ['summary'],
      'properties': {
        'summary': {'type': 'string'},
      },
    },
    'retry_policy': {
      'max_attempts': 2,
      'backoff_secs': [],
      'retry_on': ['tool_error'] as RetryableStepResultStatus[],
    },
    'supervision': {
      'owner': 'main_agent' as const,
      'allowed_outcomes': [
        {'id': 'continue', 'description': 'continue'},
        {'id': 'retry', 'description': 'retry'},
        {'id': 'fail_run', 'description': 'fail'},
      ],
      'default_outcome': 'continue',
    },
    'transitions': {
      'continue': {'next_step': 'step_b'},
      'retry': {'next_step': 'step_a'},
      'fail_run': {
        'terminate': {
          'run_status': 'failed' as const,
          'reason': 'step_a_failed',
        },
      },
    },
  };
}

function buildStepB() {
  return {
    'id': 'step_b',
    'title': 'B',
    'inputs': {},
    'executor': buildExecutor(),
    'output_schema': {
      'type': 'object',
      'required': ['summary'],
      'properties': {
        'summary': {'type': 'string'},
      },
    },
    'retry_policy': {
      'max_attempts': 2,
      'backoff_secs': [],
      'retry_on': ['tool_error'] as RetryableStepResultStatus[],
    },
    'supervision': {
      'owner': 'main_agent' as const,
      'allowed_outcomes': [
        {'id': 'back', 'description': 'back'},
        {'id': 'done', 'description': 'done'},
      ],
      'default_outcome': 'done',
    },
    'transitions': {
      'back': {'next_step': 'step_a'},
      'done': {
        'terminate': {
          'run_status': 'succeeded' as const,
          'reason': 'complete',
        },
      },
    },
  };
}

export function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'decision_continue',
    'name': 'Decision Continue',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': {
        'company': {'type': 'string'},
      },
    },
    'policies': buildPolicies(),
    'steps': [buildStepA(), buildStepB()],
    'final_output': {'ok': true},
  };
}

export function runAwaitingDecision(definition: SopDefinition, status: 'success' | 'tool_error' = 'success') {
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
      status,
      'output': status === 'success' ? {'summary': 'ok'} : undefined,
    },
  });
}
