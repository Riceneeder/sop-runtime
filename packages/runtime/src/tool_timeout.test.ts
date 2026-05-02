import {describe, expect, test} from 'bun:test';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor', () => {
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
});
