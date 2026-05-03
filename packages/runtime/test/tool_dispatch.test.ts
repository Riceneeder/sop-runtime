import {describe, expect, test} from 'bun:test';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
  RuntimeStepPacket,
  ToolRegistryExecutor,
} from '../src/index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';
import {
  buildDefinition,
  FixedClock,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('ToolRegistryExecutor dispatch', () => {
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

  test('rejects executor kind "bash" as unsupported', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket({
      'executor': {
        'kind': 'bash',
        'name': 'bash',
        'config': {'command_template': 'echo ok', 'path': '/tmp'},
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

  test('rejects executor kind "llm" as unsupported', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket({
      'executor': {
        'kind': 'llm',
        'name': 'demo-model',
        'config': {'model': 'demo-model', 'prompt_template': 'hello', 'path': '/tmp'},
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

  test('missing output (defaulted to {}) does not fake business success — RuntimeHost integration', async () => {
    // When ToolRegistryExecutor defaults missing output to {}, and the step's
    // output_schema has required fields (like 'summary'), core's applyStepResult
    // must reject it as invalid_output rather than treating it as a successful
    // business output.
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    const toolExecutor = new ToolRegistryExecutor({
      'handlers': {
        default_tool: async () => ({
          'artifacts': {'report': '/tmp/report.txt'},
          // intentionally no 'output' — ToolRegistryExecutor defaults to {}
        }),
      },
    });

    // ToolRegistryExecutor only handles kind === 'sandbox_tool'
    host.registerExecutor('sandbox_tool', 'default_tool', (input) =>
      toolExecutor.execute(input.packet as RuntimeStepPacket),
    );

    // buildDefinition already has output_schema: { type: 'object', required: ['summary'] }
    const definition = buildDefinition();
    definition.steps[0]!.executor.kind = 'sandbox_tool';
    const started = await host.startRun({'definition': definition, 'input': {'company': 'Acme'}});
    const state = await host.runReadyStep({'definition': definition, 'runId': started.state.run_id});

    // The empty default output {} does not satisfy required field 'summary'
    expect(state.accepted_results.step_a?.status).toBe('invalid_output');
    expect(state.accepted_results.step_a?.output).toBeUndefined();
  });
});
