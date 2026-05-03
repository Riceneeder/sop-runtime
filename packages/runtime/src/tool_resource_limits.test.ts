import {describe, expect, test} from 'bun:test';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor resource limits', () => {
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

  test('setTimeout upper bound protection — large timeout_secs clamped to MAX_SET_TIMEOUT_MS', async () => {
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
});
