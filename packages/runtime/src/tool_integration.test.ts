import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {DefaultDecisionProvider, InMemoryStateStore, RuntimeHost} from './index.js';

describe('ToolRegistryExecutor integration with RuntimeHost', () => {
  test('runs a sandbox_tool SOP end to end and renders final_output', async () => {
    const definition: SopDefinition = {
      'sop_id': 'tool_registry_flow',
      'name': 'Tool Registry Flow',
      'version': '1.0.0',
      'entry_step': 'step_a',
      'input_schema': {
        'type': 'object',
        'required': ['company'],
        'properties': {
          'company': {'type': 'string'},
        },
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
        'inputs': {
          'company': '${run.input.company}',
        },
        'executor': {
          'kind': 'sandbox_tool',
          'name': 'summarize',
          'config': {'command_template': 'summarize'},
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
          'properties': {
            'summary': {'type': 'string'},
          },
          'additionalProperties': false,
        },
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
      },
    };

    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'decisionProvider': new DefaultDecisionProvider(),
    });
    host.registerExecutor('sandbox_tool', 'summarize', async (input) => {
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': {'summary': `summary for ${String(input.packet.inputs.company)}`},
        'artifacts': {'report_md': '/tmp/report.md'},
      };
    });

    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });
    const completed = await host.runUntilComplete({
      definition,
      'runId': started.state.run_id,
    });

    expect(completed.state.status).toBe('succeeded');
    expect(completed.final_output).toEqual({
      'summary': 'summary for Acme',
    });
  });
});
