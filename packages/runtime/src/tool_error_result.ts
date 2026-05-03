import { JsonObject, StepResult } from '@sop-runtime/definition';
import { RuntimeStepPacket } from './step_executor.js';

/** Executor kind is not registered. 执行器类型未注册。 */
export const UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE = 'unsupported_executor_kind';
/** The named tool is not registered in the tool registry. 工具注册表中未注册指定工具。 */
export const UNKNOWN_TOOL_ERROR_CODE = 'unknown_tool';
/** The tool handler threw an unexpected error. 工具处理器抛出了意外错误。 */
export const TOOL_HANDLER_FAILURE_ERROR_CODE = 'tool_handler_failure';
/** The tool handler execution exceeded the configured timeout. 工具处理器执行超时。 */
export const TOOL_HANDLER_TIMEOUT_ERROR_CODE = 'tool_handler_timeout';
/** The handler output could not be serialized to JSON. 处理器输出无法序列化为 JSON。 */
export const NON_SERIALIZABLE_OUTPUT_ERROR_CODE = 'non_serializable_output';
/** The handler output exceeded max_output_bytes. 处理器输出超过 max_output_bytes。 */
export const OUTPUT_SIZE_EXCEEDED_ERROR_CODE = 'max_output_bytes_exceeded';
/** The handler artifacts count exceeded max_artifacts. 处理器制品数量超过 max_artifacts。 */
export const ARTIFACT_COUNT_EXCEEDED_ERROR_CODE = 'max_artifacts_exceeded';
/** The handler returned an output with invalid shape. 处理器返回了形状不符合要求的输出。 */
export const INVALID_HANDLER_OUTPUT_ERROR_CODE = 'invalid_handler_output';
/** The handler returned artifacts with invalid shape. 处理器返回了形状不符合要求的制品。 */
export const INVALID_HANDLER_ARTIFACTS_ERROR_CODE = 'invalid_handler_artifacts';
/** The handler returned metrics with invalid shape. 处理器返回了形状不符合要求的度量。 */
export const INVALID_HANDLER_METRICS_ERROR_CODE = 'invalid_handler_metrics';

/**
 * Build a StepResult for an error condition from a step packet and error details.
 *
 * 基于步骤数据包和错误详情构建错误 StepResult。
 *
 * @param packet - The runtime step packet that failed.
 * @param error - The error details including status, code, message, and optional details.
 * @returns A StepResult with the given error information.
 * @public
 */
export function buildErrorResult(
  packet: RuntimeStepPacket,
  error: {
    status: StepResult['status'];
    code: string;
    message: string;
    details?: JsonObject;
  },
): StepResult {
  return {
    'run_id': packet.run_id,
    'step_id': packet.step_id,
    'attempt': packet.attempt,
    'status': error.status,
    'error': {
      'code': error.code,
      'message': error.message,
      'details': error.details,
    },
  };
}
