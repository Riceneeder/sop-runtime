import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';
import {buildDefinition, buildStep} from './validator_test_helpers.js';

describe('validateDefinition', () => {
  test('reports top-level required, pattern, and min constraints', () => {
    const result = validateDefinition({
      'sop_id': 'bad id',
      'name': '',
      'version': '1',
      'entry_step': 'BadStep',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': -1,
        'max_run_secs': 0,
        'idempotency_key_template': '',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': '',
        },
      },
      'steps': [],
      'final_output': {},
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'schema_pattern',
      'schema_min_length',
      'schema_minimum',
      'schema_min_items',
      'schema_min_properties',
    ]));
  });

  test('reports unknown top-level and policy fields', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'concurrency': {
          ...buildDefinition().policies.concurrency,
          'extra': 'boom',
        },
        'extra_policy': true,
      },
      'steps': [buildStep()],
      'extra_root': true,
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'extra_root'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.extra_policy'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'policies.concurrency.extra'}),
    ]));
  });

  test('accepts step metadata while the public type still includes it', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
      },
      'steps': [{
        ...buildStep(),
        'metadata': {'owner': 'ops'} as never,
      }],
    } as never);

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.metadata'}),
    ]));
  });

  test('accepts documented top-level $schema field', () => {
    const result = validateDefinition({
      '$schema': 'https://example.com/schemas/sop-definition.schema.json',
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
      },
      'steps': [buildStep()],
    } as never);

    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_additional_property', 'path': '$schema'}),
    ]));
  });

  test('reports invalid executor shape and conditional fields', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
      },
      'steps': [{
        ...buildStep(),
        'title': '',
        'executor': {
          'kind': 'sandbox_model',
          'path': '',
          'timeout_secs': 0,
          'allow_network': true,
          'env': {'TOKEN': 1 as never},
          'resource_limits': {
            'max_output_bytes': 0,
            'max_artifacts': -1,
          },
        },
        'retry_policy': {
          'max_attempts': 0,
          'backoff_secs': [-1],
          'retry_on': ['oops' as never],
        },
        'supervision': {
          'owner': 'worker' as never,
          'allowed_outcomes': [],
          'default_outcome': '',
        },
        'transitions': {},
      }],
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'path': 'steps.0.title'}),
      expect.objectContaining({'path': 'steps.0.executor.model'}),
      expect.objectContaining({'path': 'steps.0.executor.prompt_template'}),
      expect.objectContaining({'path': 'steps.0.executor.path'}),
      expect.objectContaining({'path': 'steps.0.executor.timeout_secs'}),
      expect.objectContaining({'path': 'steps.0.executor.env.TOKEN'}),
      expect.objectContaining({'path': 'steps.0.executor.resource_limits.max_output_bytes'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.max_attempts'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.backoff_secs.0'}),
      expect.objectContaining({'path': 'steps.0.retry_policy.retry_on.0'}),
      expect.objectContaining({'path': 'steps.0.supervision.owner'}),
      expect.objectContaining({'path': 'steps.0.supervision.allowed_outcomes'}),
      expect.objectContaining({'path': 'steps.0.supervision.default_outcome'}),
      expect.objectContaining({'path': 'steps.0.transitions'}),
    ]));
  });

  test('reports invalid transition terminal shape', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
      },
      'steps': [{
        ...buildStep(),
        'transitions': {
          'continue': {
            'terminate': {
              'run_status': 'done' as never,
              'reason': '',
            },
          },
        },
      }],
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.run_status'}),
      expect.objectContaining({'path': 'steps.0.transitions.continue.terminate.reason'}),
    ]));
  });

  test('reports transition one-of and unknown-key violations', () => {
    const result = validateDefinition({
      ...buildDefinition(),
      'policies': {
        ...buildDefinition().policies,
        'max_run_secs': 1,
      },
      'steps': [{
        ...buildStep(),
        'supervision': {
          'owner': 'main_agent',
          'allowed_outcomes': [
            {'id': 'both', 'description': 'both'},
            {'id': 'neither', 'description': 'neither'},
            {'id': 'extra', 'description': 'extra'},
          ],
          'default_outcome': 'both',
        },
        'transitions': {
          'both': {
            'next_step': 'step_a',
            'terminate': {
              'run_status': 'succeeded',
              'reason': 'done',
            },
          },
          'neither': {},
          'extra': {'unexpected': true},
        },
      }],
    } as never);

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.both'}),
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.neither'}),
      expect.objectContaining({'code': 'schema_one_of', 'path': 'steps.0.transitions.extra'}),
      expect.objectContaining({'code': 'schema_additional_property', 'path': 'steps.0.transitions.extra.unexpected'}),
    ]));
  });
});
