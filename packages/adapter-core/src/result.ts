import { JsonObject, StepResult } from '@sop-runtime/definition';
import { RuntimeStepPacket } from './types.js';

/**
 * Build a success StepResult from a packet and output.
 *
 * 从数据包和输出构建成功 StepResult。
 *
 * @param packet - The runtime step packet.
 * @param output - The structured output (defaults to empty object).
 * @param artifacts - Optional string-string artifact map (defaults to empty object).
 * @returns A success StepResult.
 * @public
 */
export function buildSuccessResult(
  packet: RuntimeStepPacket,
  output: JsonObject = {},
  artifacts?: Record<string, string>,
): StepResult {
  return {
    run_id: packet.run_id,
    step_id: packet.step_id,
    attempt: packet.attempt,
    status: 'success',
    output,
    artifacts: artifacts ?? {},
  };
}

/**
 * Build a tool_error StepResult from a packet and error details.
 *
 * 从数据包和错误详情构建 tool_error StepResult。
 *
 * @param packet - The runtime step packet.
 * @param code - The error code.
 * @param message - The error message.
 * @param details - Optional structured error details.
 * @returns A tool_error StepResult.
 * @public
 */
export function buildToolErrorResult(
  packet: RuntimeStepPacket,
  code: string,
  message: string,
  details?: JsonObject,
): StepResult {
  return {
    run_id: packet.run_id,
    step_id: packet.step_id,
    attempt: packet.attempt,
    status: 'tool_error',
    error: { code, message, details },
  };
}

/**
 * Build a timeout StepResult from a packet.
 *
 * 从数据包构建超时 StepResult。
 *
 * @param packet - The runtime step packet.
 * @param message - Optional timeout message; defaults to a standard message.
 * @param details - Optional structured details (defaults to timeout_secs).
 * @returns A timeout StepResult.
 * @public
 */
export function buildTimeoutResult(
  packet: RuntimeStepPacket,
  message?: string,
  details?: JsonObject,
): StepResult {
  return {
    run_id: packet.run_id,
    step_id: packet.step_id,
    attempt: packet.attempt,
    status: 'timeout',
    error: {
      code: 'executor_timeout',
      message: message ?? 'Executor timed out.',
      details: details ?? { timeout_secs: packet.executor.timeout_secs },
    },
  };
}

/**
 * Build a sandbox_error StepResult from a packet and error details.
 *
 * 从数据包和错误详情构建 sandbox_error StepResult。
 *
 * @param packet - The runtime step packet.
 * @param code - The error code.
 * @param message - The error message.
 * @param details - Optional structured error details.
 * @returns A sandbox_error StepResult.
 * @public
 */
export function buildSandboxErrorResult(
  packet: RuntimeStepPacket,
  code: string,
  message: string,
  details?: JsonObject,
): StepResult {
  return {
    run_id: packet.run_id,
    step_id: packet.step_id,
    attempt: packet.attempt,
    status: 'sandbox_error',
    error: { code, message, details },
  };
}
