import {RetryableStepResultStatus, SopDefinition} from '@sop-runtime/definition';

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

function buildExecutorConfig() {
  return {
    'kind': 'web_search',
    'name': 'web_search',
    'config': {'command_template': 'Search', 'path': '/tmp'},
    'timeout_secs': 120,
    'allow_network': true,
    'env': {},
    'resource_limits': {
      'max_output_bytes': 1024,
      'max_artifacts': 1,
    },
  };
}

function buildStep() {
  return {
    'id': 'step_a',
    'title': 'A',
    'inputs': {'company': '${run.input.company}'},
    'executor': buildExecutorConfig(),
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
      'retry_on': ['tool_error'] as RetryableStepResultStatus[],
    },
    'supervision': {
      'owner': 'main_agent' as const,
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
          'run_status': 'succeeded' as const,
          'reason': 'complete',
        },
      },
    },
  };
}

export function buildDefinition(): SopDefinition {
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
    'policies': buildPolicies(),
    'steps': [buildStep()],
    'final_output': {'ok': true},
  };
}
