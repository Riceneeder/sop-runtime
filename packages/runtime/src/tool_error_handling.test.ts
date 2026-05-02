import {describe, expect, test} from 'bun:test';
import {JsonObject} from '@sop-runtime/definition';
import {ToolRegistryExecutor} from './index.js';
import {buildPacket, expectResultIdentity} from './tool_registry_test_helpers.js';

describe('ToolRegistryExecutor error handling', () => {
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
});
