import {SopDefinition, StepDefinition} from '@sop-runtime/definition';

export function buildStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    'id': 'step_a',
    'title': 'A',
    'inputs': {},
    'executor': {
      'kind': 'sandbox_tool',
      'tool': 'web_search',
      'command_template': 'Search',
      'path': '/tmp/workspace',
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
      'allowed_outcomes': [{'id': 'continue', 'description': 'go'}],
      'default_outcome': 'continue',
    },
    'transitions': {
      'continue': {'next_step': 'step_a'},
    },
    ...overrides,
  };
}

export function buildDefinition(overrides: Partial<SopDefinition> = {}): SopDefinition {
  return {
    'sop_id': 'ok_id',
    'name': 'Test',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {'type': 'object'},
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'key',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'key',
      },
    },
    'steps': [buildStep()],
    'final_output': {'summary': 'ok'},
    ...overrides,
  };
}
