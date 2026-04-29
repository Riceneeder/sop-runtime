import {JsonObject, StepResult} from '@sop-runtime/definition';
import {StepExecutor, RuntimeStepPacket} from './step_executor.js';

const UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE = 'unsupported_executor_kind';
const UNKNOWN_TOOL_ERROR_CODE = 'unknown_tool';
const TOOL_HANDLER_FAILURE_ERROR_CODE = 'tool_handler_failure';
const TOOL_HANDLER_TIMEOUT_ERROR_CODE = 'tool_handler_timeout';
const NON_SERIALIZABLE_OUTPUT_ERROR_CODE = 'non_serializable_output';
const OUTPUT_SIZE_EXCEEDED_ERROR_CODE = 'max_output_bytes_exceeded';
const ARTIFACT_COUNT_EXCEEDED_ERROR_CODE = 'max_artifacts_exceeded';
const INVALID_HANDLER_OUTPUT_ERROR_CODE = 'invalid_handler_output';
const INVALID_HANDLER_ARTIFACTS_ERROR_CODE = 'invalid_handler_artifacts';
const INVALID_HANDLER_METRICS_ERROR_CODE = 'invalid_handler_metrics';

const MAX_SET_TIMEOUT_MS = 2_147_483_647;

export interface ToolHandlerInput {
  run_id: string;
  step_id: string;
  attempt: number;
  inputs: JsonObject;
  command: string;
  executor: RuntimeStepPacket['executor'];
}

export interface ToolHandlerResult {
  output?: JsonObject;
  artifacts?: Record<string, string>;
  metrics?: JsonObject;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<ToolHandlerResult> | ToolHandlerResult;

export interface ToolRegistryExecutorOptions {
  handlers: Record<string, ToolHandler>;
}

/**
 * Lightweight built-in executor that dispatches sandbox_tool packets to host-registered handlers.
 */
export class ToolRegistryExecutor implements StepExecutor {
  private readonly handlers: Record<string, ToolHandler>;

  constructor(options: ToolRegistryExecutorOptions) {
    this.handlers = {...options.handlers};
  }

  async execute(packet: RuntimeStepPacket): Promise<StepResult> {
    if (packet.executor.kind !== 'sandbox_tool') {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE,
        'message': `Executor kind ${packet.executor.kind} is not supported by ToolRegistryExecutor.`,
        'details': {'executor_kind': packet.executor.kind},
      });
    }

    const handler = this.handlers[packet.executor.tool];
    if (handler === undefined) {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': UNKNOWN_TOOL_ERROR_CODE,
        'message': `No handler is registered for tool ${packet.executor.tool}.`,
        'details': {'tool': packet.executor.tool},
      });
    }

    const command = renderCommandTemplate(packet.executor.command_template, packet.inputs);
    const invocation = await this.executeWithTimeout(() => handler({
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'inputs': packet.inputs,
      'command': command,
      'executor': packet.executor,
    }), packet.executor.timeout_secs);

    if (invocation.kind === 'timeout') {
      return this.buildErrorResult(packet, {
        'status': 'timeout',
        'code': TOOL_HANDLER_TIMEOUT_ERROR_CODE,
        'message': `Tool ${packet.executor.tool} timed out.`,
        'details': {
          'tool': packet.executor.tool,
          'timeout_secs': packet.executor.timeout_secs,
        },
      });
    }

    if (invocation.kind === 'error') {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': TOOL_HANDLER_FAILURE_ERROR_CODE,
        'message': `Tool ${packet.executor.tool} handler failed.`,
        'details': {
          'tool': packet.executor.tool,
          'reason': toErrorMessage(invocation.error),
        },
      });
    }

    const output = invocation.result.output ?? {};
    if (!isJsonSafeObject(output)) {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': INVALID_HANDLER_OUTPUT_ERROR_CODE,
        'message': 'Tool handler returned an invalid output payload.',
      });
    }

    const artifacts = invocation.result.artifacts ?? {};
    if (!isStringRecord(artifacts)) {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': INVALID_HANDLER_ARTIFACTS_ERROR_CODE,
        'message': 'Tool handler returned invalid artifacts.',
      });
    }

    if (invocation.result.metrics !== undefined && !isJsonSafeObject(invocation.result.metrics)) {
      return this.buildErrorResult(packet, {
        'status': 'tool_error',
        'code': INVALID_HANDLER_METRICS_ERROR_CODE,
        'message': 'Tool handler returned invalid metrics.',
      });
    }
    const outputSize = computeJsonUtf8Size(output);
    if (outputSize === null) {
      return this.buildErrorResult(packet, {
        'status': 'sandbox_error',
        'code': NON_SERIALIZABLE_OUTPUT_ERROR_CODE,
        'message': 'Tool output could not be serialized to JSON.',
      });
    }

    if (outputSize > packet.executor.resource_limits.max_output_bytes) {
      return this.buildErrorResult(packet, {
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
      return this.buildErrorResult(packet, {
        'status': 'sandbox_error',
        'code': ARTIFACT_COUNT_EXCEEDED_ERROR_CODE,
        'message': 'Tool artifacts exceed max_artifacts.',
        'details': {
          'artifact_count': artifactCount,
          'max_artifacts': packet.executor.resource_limits.max_artifacts,
        },
      });
    }

    return {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'status': 'success',
      output,
      artifacts,
      'metrics': invocation.result.metrics,
    };
  }

  private buildErrorResult(
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

  private async executeWithTimeout(
    task: () => Promise<ToolHandlerResult> | ToolHandlerResult,
    timeoutSecs: number,
  ): Promise<
      | {kind: 'result'; result: ToolHandlerResult}
      | {kind: 'error'; error: unknown}
      | {kind: 'timeout'}
    > {
    const safePromise = Promise.resolve()
      .then(() => task())
      .then((result) => ({'kind': 'result' as const, 'result': result}))
      .catch((error) => ({'kind': 'error' as const, 'error': error}));

    const timeoutMs = normalizeTimeoutMs(timeoutSecs);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{kind: 'timeout'}>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({'kind': 'timeout'});
      }, timeoutMs);
    });

    const outcome = await Promise.race([safePromise, timeoutPromise]);
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    return outcome;
  }
}

function renderCommandTemplate(template: string, inputs: JsonObject): string {
  return template.replaceAll(/\$\{([^}]+)\}/g, (_match, capture: string) => {
    const value = resolvePath(inputs, capture.trim());
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

function resolvePath(root: JsonObject, dottedPath: string): unknown {
  if (dottedPath.length === 0) {
    return undefined;
  }
  const segments = dottedPath.split('.').filter((segment) => segment.length > 0);
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    const asRecord = current as Record<string, unknown>;
    current = asRecord[segment];
    if (current === undefined || current === null) {
      return current;
    }
  }
  return current;
}

function computeJsonUtf8Size(value: JsonObject): number | null {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return null;
    }
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeTimeoutMs(timeoutSecs: number): number {
  const timeoutMs = Math.max(0, timeoutSecs * 1000);
  return Math.min(timeoutMs, MAX_SET_TIMEOUT_MS);
}

function isJsonSafeObject(value: unknown): value is JsonObject {
  return isStrictPlainObject(value) && isJsonSafeValue(value, new Set<object>());
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonSafeValue(value: unknown, seen: Set<object>): boolean {
  if (value === null) {
    return true;
  }
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return true;
  }
  if (valueType === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonSafeValue(entry, seen));
  }
  if (!isStrictPlainObject(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  for (const entry of Object.values(value)) {
    if (!isJsonSafeValue(entry, seen)) {
      return false;
    }
  }
  seen.delete(value);
  return true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isStrictPlainObject(value)) {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') {
      return false;
    }
  }
  return true;
}
