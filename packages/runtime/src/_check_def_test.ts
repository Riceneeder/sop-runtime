import {validateDefinition} from '../../validator/src/index.js';

const definition = {
  'sop_id': 'tool_registry_flow',
  'name': 'Tool Registry Flow',
  'version': '1.0.0',
  'entry_step': 'step_a',
  'input_schema': {
    'type': 'object',
    'required': ['company'],
    'properties': {'company': {'type': 'string'}},
    'additionalProperties': false,
  },
  'policies': {
    'cooldown_secs': 0,
    'max_run_secs': 60,
    'idempotency_key_template': 'run:${run.input.company}',
    'concurrency': {
      'mode': 'singleflight',
      'key_template': 'run:${run.input.company}',
    },
  },
  'steps': [{
    'id': 'step_a',
    'title': 'A',
    'inputs': {'company': '${run.input.company}'},
    'executor': {
      'kind': 'sandbox_tool',
      'name': 'summarize',
      'config': { 'command_template': 'summarize ${run.input.company}' },
      'timeout_secs': 120,
      'allow_network': true,
      'env': {},
      'resource_limits': {'max_output_bytes': 1024, 'max_artifacts': 1},
    },
    'output_schema': {
      'type': 'object',
      'required': ['summary'],
      'properties': {'summary': {'type': 'string'}},
      'additionalProperties': false,
    },
    'retry_policy': {'max_attempts': 1, 'backoff_secs': [], 'retry_on': []},
    'supervision': {
      'owner': 'main_agent',
      'allowed_outcomes': [{'id': 'done', 'description': 'done'}],
      'default_outcome': 'done',
    },
    'transitions': {
      'done': {'terminate': {'run_status': 'succeeded', 'reason': 'complete'}},
    },
  }],
  'final_output': {'summary': '${steps.step_a.output.summary}'},
};

const result = validateDefinition(definition as never);
console.log('ok:', result.ok);
for (const d of result.diagnostics) {
  console.log(`  ${d.path} [${d.code}]: ${d.message}`);
}
