import {describe, expect, test} from 'bun:test';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

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

  test('returns tool_error for sandbox_script', async () => {
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

  test('returns tool_error for sandbox_model', async () => {
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
});
