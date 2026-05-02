import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {CoreError, buildStepPacket, createRun, getCurrentStep} from './index.js';

function buildDefinition(): SopDefinition {
  return {
    'sop_id': 'packet_render',
    'name': 'Packet Render',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': {
        'company': {'type': 'string'},
        'workspace': {'type': 'string'},
      },
    },
    'defaults': {'workspace': '/tmp/default'},
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
      'inputs': {
        'company': '${run.input.company}',
        'payload': {
          'location': '${coalesce(run.input.workspace, "/tmp/fallback")}',
        },
      },
      'executor': {
        'kind': 'web_search',
          'name': 'web_search',
          'config': { 'command_template': 'Search ${run.input.company}', 'path': '${run.input.workspace}' },
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
    'final_output': {'ok': true},
  };
}

describe('buildStepPacket', () => {
  test('renders nested inputs and passes executor config through unchanged', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const packet = buildStepPacket({
      definition,
      state,
    });

    expect(packet.inputs).toEqual({
      'company': 'Acme',
      'payload': {
        'location': '/tmp/default',
      },
    });
    expect(packet.executor.kind).toBe('web_search');
    expect(packet.executor.name).toBe('web_search');
    // Executor config is handler-owned opaque data — templates are passed through as-is.
    expect(packet.executor.config).toEqual({
      'command_template': 'Search ${run.input.company}',
      'path': '${run.input.workspace}',
    });
  });

  test('rejects non-JSON values resolved from direct references', () => {
    const definition = buildDefinition();
    const created = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const state = {
      ...created,
      'run_input': {
        ...created.run_input,
        'company': new Date('2026-04-20T12:30:00Z'),
      } as never,
    };

    let error: unknown;
    try {
      buildStepPacket({
        definition,
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('expression_evaluation_failed');
  });

  test('exposes current step while awaiting decision but rejects packet construction', () => {
    const definition = buildDefinition();
    const readyState = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const state = {
      ...readyState,
      'phase': 'awaiting_decision' as const,
      'steps': {
        ...readyState.steps,
        'step_a': {
          ...readyState.steps.step_a!,
          'status': 'waiting_decision' as const,
        },
      },
    };

    expect(getCurrentStep({
      definition,
      state,
    })?.step_id).toBe('step_a');

    let error: unknown;
    try {
      buildStepPacket({
        definition,
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('rejects a definition that does not match the persisted run SOP id/version', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });

    let error: unknown;
    try {
      buildStepPacket({
        'definition': {
          ...definition,
          'version': '9.9.9',
        },
        state,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });

  test('isolates the packet executor from the original definition', () => {
    const definition = buildDefinition();
    const state = createRun({
      definition,
      'input': {'company': 'Acme'},
      'runId': 'run_001',
    });
    const packet = buildStepPacket({definition, state});

    // Simulate the mutation that runtime_host applies via beforeStep hooks.
    (packet.executor as { config?: Record<string, unknown> }).config = {
      'mutated': true,
    };

    // The original definition must be unaffected.
    expect(definition.steps[0]!.executor.config).toEqual({
      'command_template': 'Search ${run.input.company}',
      'path': '${run.input.workspace}',
    });
  });
});
