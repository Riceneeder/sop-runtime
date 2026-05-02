import {describe, expect, test} from 'bun:test';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor', () => {
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
});
