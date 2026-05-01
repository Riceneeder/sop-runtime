import {describe, expect, test} from 'bun:test';
import {JsonObject, SopDefinition, StepResult} from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeStepPacket,
  RuntimeHost,
  ToolRegistryExecutor,
} from './index.js';

function buildPacket(overrides: Partial<RuntimeStepPacket> = {}): RuntimeStepPacket {
  const base: RuntimeStepPacket = {
    'run_id': 'run_001',
    'step_id': 'step_a',
    'attempt': 1,
    'inputs': {
      'company': 'Acme',
      'count': 2,
      'enabled': true,
      'nested': {'value': 'ok'},
      'missing': null,
    },
    'executor': {
      'kind': 'sandbox_tool',
          'name': 'demo_tool',
          'config': { 'command_template': 'do ${company} ${nested.value} ${missing} ${unknown}' },
      'timeout_secs': 1,
      'allow_network': false,
      'env': {},
      'resource_limits': {
        'max_output_bytes': 1024,
        'max_artifacts': 2,
      },
    },
    'output_schema': {
      'type': 'object',
    },
  };
  return {
    ...base,
    ...overrides,
    'executor': {
      ...base.executor,
      ...overrides.executor,
      'resource_limits': {
        ...base.executor.resource_limits,
        ...overrides.executor?.resource_limits,
      },
    },
  };
}

function expectResultIdentity(result: StepResult, packet: RuntimeStepPacket): void {
  expect(result.run_id).toBe(packet.run_id);
  expect(result.step_id).toBe(packet.step_id);
  expect(result.attempt).toBe(packet.attempt);
}

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

  test('returns tool_error for unknown tools', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket();

    const result = await executor.execute(packet);

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('unknown_tool');
    expectResultIdentity(result, packet);
  });

  test('returns tool_error when a handler throws', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        demo_tool() {
          throw new Error('boom');
        },
      },
    });
    const packet = buildPacket();

    const result = await executor.execute(packet);

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('tool_handler_failure');
    expect(result.error?.details?.reason).toBe('boom');
    expectResultIdentity(result, packet);
  });

  test('returns timeout when a handler exceeds timeout_secs', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {'output': {'ok': true}};
        },
      },
    });
    const packet = buildPacket({
      'executor': {
        ...buildPacket().executor,
        'timeout_secs': 0.001,
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('timeout');
    expect(result.error?.code).toBe('tool_handler_timeout');
    expectResultIdentity(result, packet);
  });

  test('returns sandbox_error when output exceeds max_output_bytes', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': {'value': '1234567890'}};
        },
      },
    });
    const packet = buildPacket({
      'executor': {
        ...buildPacket().executor,
        'resource_limits': {
          'max_output_bytes': 5,
          'max_artifacts': 2,
        },
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('sandbox_error');
    expect(result.error?.code).toBe('max_output_bytes_exceeded');
    expectResultIdentity(result, packet);
  });

  test('returns sandbox_error when artifacts exceed max_artifacts', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {
            'output': {'ok': true},
            'artifacts': {'a': '/tmp/a', 'b': '/tmp/b'},
          };
        },
      },
    });
    const packet = buildPacket({
      'executor': {
        ...buildPacket().executor,
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('sandbox_error');
    expect(result.error?.code).toBe('max_artifacts_exceeded');
    expectResultIdentity(result, packet);
  });

  test('returns tool_error when handler output contains cycles', async () => {
    const cyclic = {} as {self?: unknown};
    cyclic.self = cyclic;

    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': cyclic as never};
        },
      },
    });
    const packet = buildPacket();

    const result = await executor.execute(packet);

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_output');
    expectResultIdentity(result, packet);
  });

  test('returns tool_error when handler result is null', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return null as never;
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_output');
  });

  test('returns tool_error when handler output contains cyclic arrays', async () => {
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);

    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': {'items': cyclicArray as unknown as JsonObject}};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_output');
  });


  test('returns tool_error when handler output is not a JSON-safe object', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': [] as never};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_output');
  });

  test('returns tool_error when handler artifacts are not a string record', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': {'ok': true}, 'artifacts': {'a': 1} as never};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_artifacts');
  });

  test('returns tool_error when handler metrics are not a JSON-safe object', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          return {'output': {'ok': true}, 'metrics': [] as never};
        },
      },
    });

    const result = await executor.execute(buildPacket());

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('invalid_handler_metrics');
  });

  test('clamps very large timeout_secs values to avoid immediate timeout overflow', async () => {
    const executor = new ToolRegistryExecutor({
      'handlers': {
        async demo_tool() {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {'output': {'ok': true}};
        },
      },
    });
    const packet = buildPacket({
      'executor': {
        ...buildPacket().executor,
        'timeout_secs': 3_000_000,
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('success');
  });
  test('returns tool_error for sandbox_script', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket({
      'executor': {
        'kind': 'bash',
          'name': 'bash',
          'config': { 'command_template': 'echo ok', 'path': '/tmp' },
        'timeout_secs': 1,
        'allow_network': false,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('unsupported_executor_kind');
    expectResultIdentity(result, packet);
  });

  test('returns tool_error for sandbox_model', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket({
      'executor': {
        'kind': 'llm',
          'name': 'demo-model',
          'config': { 'model': 'demo-model', 'prompt_template': 'hello', 'path': '/tmp' },
        'timeout_secs': 1,
        'allow_network': false,
        'env': {},
        'resource_limits': {
          'max_output_bytes': 1024,
          'max_artifacts': 1,
        },
      },
    });

    const result = await executor.execute(packet);

    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('unsupported_executor_kind');
    expectResultIdentity(result, packet);
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
          'name': 'summarize',
          'config': { 'command_template': 'summarize' },
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
