import {describe, expect, test} from 'bun:test';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor', () => {
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
          return {'output': {'items': cyclicArray}} as never;
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

  test('returns tool_error for sandbox_script', async () => {
    const executor = new ToolRegistryExecutor({'handlers': {}});
    const packet = buildPacket({
      'executor': {
        'kind': 'sandbox_script',
        'tool': 'bash',
        'command_template': 'echo ok',
        'path': '/tmp',
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
        'kind': 'sandbox_model',
        'model': 'demo-model',
        'prompt_template': 'hello',
        'path': '/tmp',
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
});
