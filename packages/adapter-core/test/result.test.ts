import { describe, expect, test } from 'bun:test';
import { StepPacket } from '@sop-runtime/definition';
import {
  buildSuccessResult,
  buildToolErrorResult,
  buildTimeoutResult,
  buildSandboxErrorResult,
} from '../src/result.js';

function makePacket(overrides?: Partial<StepPacket>): StepPacket {
  return {
    run_id: 'run_001',
    step_id: 'step_a',
    attempt: 1,
    inputs: {},
    output_schema: {},
    executor: {
      kind: 'test',
      name: 'my_executor',
      config: {},
      timeout_secs: 30,
      allow_network: false,
      env: {},
      resource_limits: { max_output_bytes: 1024, max_artifacts: 5 },
    },
    ...overrides,
  };
}

describe('buildSuccessResult', () => {
  test('returns success with default output and empty artifacts', () => {
    const result = buildSuccessResult(makePacket());
    expect(result.run_id).toBe('run_001');
    expect(result.step_id).toBe('step_a');
    expect(result.attempt).toBe(1);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({});
    expect(result.artifacts).toEqual({});
  });

  test('includes provided output and artifacts', () => {
    const result = buildSuccessResult(
      makePacket(),
      { summary: 'done', count: 42 },
      { report: '/tmp/r.md' },
    );
    expect(result.output).toEqual({ summary: 'done', count: 42 });
    expect(result.artifacts).toEqual({ report: '/tmp/r.md' });
  });
});

describe('buildToolErrorResult', () => {
  test('returns tool_error with code and message', () => {
    const result = buildToolErrorResult(makePacket(), 'my_error', 'Something failed.');
    expect(result.status).toBe('tool_error');
    expect(result.error?.code).toBe('my_error');
    expect(result.error?.message).toBe('Something failed.');
    expect(result.run_id).toBe('run_001');
  });

  test('includes optional details', () => {
    const result = buildToolErrorResult(makePacket(), 'err', 'msg', { detail_key: 'val' });
    expect(result.error?.details).toEqual({ detail_key: 'val' });
  });
});

describe('buildTimeoutResult', () => {
  test('returns timeout with default message and details', () => {
    const result = buildTimeoutResult(makePacket());
    expect(result.status).toBe('timeout');
    expect(result.error?.code).toBe('executor_timeout');
    expect(result.error?.details?.timeout_secs).toBe(30);
  });

  test('includes custom message and details', () => {
    const result = buildTimeoutResult(makePacket(), 'Custom timeout.', { reason: 'slow' });
    expect(result.error?.message).toBe('Custom timeout.');
    expect(result.error?.details?.reason).toBe('slow');
  });
});

describe('buildSandboxErrorResult', () => {
  test('returns sandbox_error with code and message', () => {
    const result = buildSandboxErrorResult(makePacket(), 'sandbox_err', 'Sandbox denied.');
    expect(result.status).toBe('sandbox_error');
    expect(result.error?.code).toBe('sandbox_err');
    expect(result.error?.message).toBe('Sandbox denied.');
  });
});
