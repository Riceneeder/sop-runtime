import {describe, expect, test} from 'bun:test';
import {SopDefinition} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
  ToolRegistryExecutor,
} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor', () => {
  test('calls a registered sandbox_tool handler', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {
            'output': {'ok': true},
            'artifacts': {'report': '/tmp/report.txt'},
            'metrics': {'elapsed_ms': 10},
          };
        },
      },
    });

    const packet = buildPacket();
    const result = await executor.execute(packet);

    expect(result.status).toBe('success');
    expect(result.output).toEqual({'ok': true});
    expect(result.artifacts).toEqual({'report': '/tmp/report.txt'});
    expect(result.metrics).toEqual({'elapsed_ms': 10});
    expectResultIdentity(result, packet);
  });

  test('renders command templates from packet inputs', async () => {
    let observedCommand = '';
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool(input) {
          observedCommand = input.command;
          return {'output': {'ok': true}};
        },
      },
    });

    const packet = buildPacket();
    const result = await executor.execute(packet);

    expect(result.status).toBe('success');
    expect(observedCommand).toBe('do Acme ok  ');
  });

  test('defaults missing output to an empty object on success', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'artifacts': {'a': '/tmp/a'}};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('success');
    expect(result.output).toEqual({});
  });

  test('defaults missing artifacts to an empty object on success', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': {'ok': true}};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('success');
    expect(result.artifacts).toEqual({});
  });
});

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
          'tool': 'summarize',
          'command_template': 'summarize ${company}',
          'path': '/tmp',
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
        'artifact': '${steps.step_a.artifacts.report_md}',
      },
    };

    const executor = new ToolRegistryExecutor({
      'handlers': {
        async summarize(input) {
          return {
            'output': {'summary': `summary for ${String(input.inputs.company)}`},
            'artifacts': {'report_md': '/tmp/report.md'},
          };
        },
      },
    });

    const host = new RuntimeHost({
      'store': new InMemoryStateStore(),
      'executor': executor,
      'decisionProvider': new DefaultDecisionProvider(),
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
      'artifact': '/tmp/report.md',
    });
  });
});
