import { JsonObject, StepResult } from '@sop-runtime/definition';
import { RuntimeStepPacket } from './step_executor.js';

export const UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE = 'unsupported_executor_kind';
export const UNKNOWN_TOOL_ERROR_CODE = 'unknown_tool';
export const TOOL_HANDLER_FAILURE_ERROR_CODE = 'tool_handler_failure';
export const TOOL_HANDLER_TIMEOUT_ERROR_CODE = 'tool_handler_timeout';
export const NON_SERIALIZABLE_OUTPUT_ERROR_CODE = 'non_serializable_output';
export const OUTPUT_SIZE_EXCEEDED_ERROR_CODE = 'max_output_bytes_exceeded';
export const ARTIFACT_COUNT_EXCEEDED_ERROR_CODE = 'max_artifacts_exceeded';
export const INVALID_HANDLER_OUTPUT_ERROR_CODE = 'invalid_handler_output';
export const INVALID_HANDLER_ARTIFACTS_ERROR_CODE = 'invalid_handler_artifacts';
export const INVALID_HANDLER_METRICS_ERROR_CODE = 'invalid_handler_metrics';

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
