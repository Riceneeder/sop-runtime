import { describe, expect, test } from 'bun:test';
import { StepResult } from '@sop-runtime/definition';
import {
  executeHandlerWithTimeout,
  enforceResourceLimits,
  EnforceResourceLimitsParams,
} from './executor_enforcer.js';

function buildSuccessResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    'run_id': 'run_001',
    'step_id': 'step_a',
    'attempt': 1,
    'status': 'success',
    'output': { 'summary': 'ok' },
    'artifacts': { 'report': '/tmp/report.md' },
    ...overrides,
  };
}

function enforce(params: Omit<EnforceResourceLimitsParams, 'invalidPayloadPolicy'>): StepResult {
  return enforceResourceLimits(params);
}

describe('executeHandlerWithTimeout', () => {
  test('returns result when handler completes within timeout', async () => {
    const result = buildSuccessResult();
    const outcome = await executeHandlerWithTimeout(() => result, 60);

    expect(outcome.kind).toBe('result');
    expect((outcome as { kind: 'result'; result: StepResult }).result).toEqual(result);
  });

  test('returns timeout when handler exceeds deadline', async () => {
    const outcome = await executeHandlerWithTimeout(
      () => new Promise<StepResult>((_resolve) => { /* never settles */ }),
      0.001,
    );

    expect(outcome.kind).toBe('timeout');
  });

  test('returns error when handler throws', async () => {
    const err = new Error('handler crash');
    const outcome = await executeHandlerWithTimeout(() => { throw err; }, 60);

    expect(outcome.kind).toBe('error');
    expect((outcome as { kind: 'error'; error: unknown }).error).toBe(err);
  });

  test('rejects synchronous result when wall-clock exceeds timeout', async () => {
    const result = buildSuccessResult();
    const outcome = await executeHandlerWithTimeout(() => result, 0);

    expect(outcome.kind).toBe('timeout');
  });
});

describe('enforceResourceLimits', () => {
  const limits = { 'max_output_bytes': 100, 'max_artifacts': 2 };

  test('passes through non-success result with compliant artifacts', () => {
    const result = buildSuccessResult({
      'status': 'tool_error',
      'artifacts': { 'a': '/tmp/a' },
    });
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced).toBe(result);
  });

  test('returns sandbox_error when non-success result exceeds max_artifacts', () => {
    const result = buildSuccessResult({
      'status': 'tool_error',
      'artifacts': { 'a': '/tmp/a', 'b': '/tmp/b', 'c': '/tmp/c' },
    });
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('max_artifacts_exceeded');
  });

  test('returns sandbox_error when output exceeds max_output_bytes', () => {
    const result = buildSuccessResult({ 'output': { 'data': 'x'.repeat(200) } });
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('max_output_bytes_exceeded');
  });

  test('returns sandbox_error when artifacts exceed max_artifacts', () => {
    const result = buildSuccessResult({
      'artifacts': { 'a': '/tmp/a', 'b': '/tmp/b', 'c': '/tmp/c' },
    });
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('max_artifacts_exceeded');
  });

  test('returns sandbox_error when output is not JSON-serializable (default policy)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = buildSuccessResult({ 'output': circular as never });
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('non_serializable_output');
  });

  test('passes through when within limits', () => {
    const result = buildSuccessResult();
    const enforced = enforce({ result, resourceLimits: limits, runId: 'run_001', stepId: 'step_a', attempt: 1 });

    expect(enforced).toBe(result);
  });

  test('preserve policy returns original result when artifacts is not a string record', () => {
    const result = buildSuccessResult({ 'artifacts': ['a', 'b', 'c'] as never });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced).toBe(result);
  });

  test('preserve policy returns original result when output is not JSON-serializable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = buildSuccessResult({ 'output': circular as never });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced).toBe(result);
  });

  test('preserve policy still enforces max_artifacts on valid string records', () => {
    const result = buildSuccessResult({
      'artifacts': { 'a': '/tmp/a', 'b': '/tmp/b', 'c': '/tmp/c' },
    });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('max_artifacts_exceeded');
  });

  test('preserve policy still enforces max_output_bytes on valid output', () => {
    const result = buildSuccessResult({ 'output': { 'data': 'x'.repeat(200) } });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced.status).toBe('sandbox_error');
    expect(enforced.error?.code).toBe('max_output_bytes_exceeded');
  });

  test('preserve policy returns original result when output is a string', () => {
    const result = buildSuccessResult({ 'output': 'x'.repeat(200) as never });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced).toBe(result);
  });

  test('preserve policy returns original result when output is an array', () => {
    const result = buildSuccessResult({ 'output': ['x'.repeat(200)] as never });
    const enforced = enforceResourceLimits({
      result,
      resourceLimits: limits,
      runId: 'run_001',
      stepId: 'step_a',
      attempt: 1,
      'invalidPayloadPolicy': 'preserve',
    });

    expect(enforced).toBe(result);
  });
});
