import {
  isJsonSafeObject,
  isStrictPlainObject,
  isStringRecord,
  JsonObject,
  StepResult,
} from '@sop-runtime/definition';
import { computeJsonUtf8Size } from './executor_enforcer.js';
import { RuntimeStepPacket } from './step_executor.js';
import {
  buildErrorResult,
  ARTIFACT_COUNT_EXCEEDED_ERROR_CODE,
  INVALID_HANDLER_ARTIFACTS_ERROR_CODE,
  INVALID_HANDLER_METRICS_ERROR_CODE,
  INVALID_HANDLER_OUTPUT_ERROR_CODE,
  NON_SERIALIZABLE_OUTPUT_ERROR_CODE,
  OUTPUT_SIZE_EXCEEDED_ERROR_CODE,
} from './tool_error_result.js';
import { ToolHandlerResult } from './tool_registry_executor.js';

/**
 * Validate and convert a ToolHandlerResult into a canonical StepResult.
 *
 * 校验并将 ToolHandlerResult 转换为规范的 StepResult。
 *
 * @param packet - The runtime step packet for context.
 * @param _toolName - The tool name (unused, reserved).
 * @param invocationResult - The raw result from the tool handler.
 * @returns A validated StepResult, or an error StepResult if validation fails.
 * @public
 */
export function validateHandlerResult(
  packet: RuntimeStepPacket,
  _toolName: string,
  invocationResult: ToolHandlerResult,
): StepResult {
  if (!isStrictPlainObject(invocationResult)) {
    return buildErrorResult(packet, {
      'status': 'tool_error',
      'code': INVALID_HANDLER_OUTPUT_ERROR_CODE,
      'message': 'Tool handler returned an invalid result payload.',
    });
  }

  const validationError = validateContent(invocationResult, packet);
  if (validationError !== null) return validationError;

  const output = (invocationResult.output ?? {}) as JsonObject;
  const artifacts = (invocationResult.artifacts ?? {}) as Record<string, string>;
  const limitError = enforceHandlerLimits(packet, output, artifacts);
  if (limitError !== null) return limitError;

  return {
    'run_id': packet.run_id,
    'step_id': packet.step_id,
    'attempt': packet.attempt,
    'status': 'success',
    'output': output,
    'artifacts': artifacts,
    'metrics': invocationResult.metrics as JsonObject | undefined,
  };
}

function validateContent(
  invocationResult: ToolHandlerResult,
  packet: RuntimeStepPacket,
): StepResult | null {
  const output = (invocationResult.output ?? {}) as JsonObject;
  if (!isJsonSafeObject(output)) {
    return buildErrorResult(packet, {
      'status': 'tool_error',
      'code': INVALID_HANDLER_OUTPUT_ERROR_CODE,
      'message': 'Tool handler returned an invalid output payload.',
    });
  }

  const artifacts = (invocationResult.artifacts ?? {}) as Record<string, string>;
  if (!isStringRecord(artifacts)) {
    return buildErrorResult(packet, {
      'status': 'tool_error',
      'code': INVALID_HANDLER_ARTIFACTS_ERROR_CODE,
      'message': 'Tool handler returned invalid artifacts.',
    });
  }

  const metrics = invocationResult.metrics as JsonObject | undefined;
  if (metrics !== undefined && !isJsonSafeObject(metrics)) {
    return buildErrorResult(packet, {
      'status': 'tool_error',
      'code': INVALID_HANDLER_METRICS_ERROR_CODE,
      'message': 'Tool handler returned invalid metrics.',
    });
  }

  return null;
}

function enforceHandlerLimits(
  packet: RuntimeStepPacket,
  output: JsonObject,
  artifacts: Record<string, string>,
): StepResult | null {
  const outputSize = computeJsonUtf8Size(output);
  if (outputSize === null) {
    return buildErrorResult(packet, {
      'status': 'sandbox_error',
      'code': NON_SERIALIZABLE_OUTPUT_ERROR_CODE,
      'message': 'Tool output could not be serialized to JSON.',
    });
  }

  if (outputSize > packet.executor.resource_limits.max_output_bytes) {
    return buildErrorResult(packet, {
      'status': 'sandbox_error',
      'code': OUTPUT_SIZE_EXCEEDED_ERROR_CODE,
      'message': 'Tool output exceeds max_output_bytes.',
      'details': {
        'output_bytes': outputSize,
        'max_output_bytes': packet.executor.resource_limits.max_output_bytes,
      },
    });
  }

  const artifactCount = Object.keys(artifacts).length;
  if (artifactCount > packet.executor.resource_limits.max_artifacts) {
    return buildErrorResult(packet, {
      'status': 'sandbox_error',
      'code': ARTIFACT_COUNT_EXCEEDED_ERROR_CODE,
      'message': 'Tool artifacts exceed max_artifacts.',
      'details': {
        'artifact_count': artifactCount,
        'max_artifacts': packet.executor.resource_limits.max_artifacts,
      },
    });
  }

  return null;
}
