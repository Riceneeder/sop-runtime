import {
  JsonObject,
  StepResult,
} from '@sop-runtime/definition';
import { StepExecutor, RuntimeStepPacket } from './step_executor.js';
import { normalizeTimeoutMs } from './executor_enforcer.js';
import { buildErrorResult } from './tool_error_result.js';
import { renderCommandTemplate } from './tool_command_template.js';
import { validateHandlerResult } from './tool_handler_result.js';
import {
  INVALID_HANDLER_OUTPUT_ERROR_CODE,
  TOOL_HANDLER_FAILURE_ERROR_CODE,
  TOOL_HANDLER_TIMEOUT_ERROR_CODE,
  UNKNOWN_TOOL_ERROR_CODE,
  UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE,
} from './tool_error_result.js';

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

export class ToolRegistryExecutor implements StepExecutor {
  private readonly handlers: Record<string, ToolHandler>;

  constructor(options: ToolRegistryExecutorOptions) {
    this.handlers = { ...options.handlers };
  }

  async execute(packet: RuntimeStepPacket): Promise<StepResult> {
    if (packet.executor.kind !== 'sandbox_tool') {
      return buildErrorResult(packet, {
        'status': 'tool_error',
        'code': UNSUPPORTED_EXECUTOR_KIND_ERROR_CODE,
        'message': `Executor kind ${packet.executor.kind} is not supported by ToolRegistryExecutor.`,
        'details': { 'executor_kind': packet.executor.kind },
      });
    }

    const toolName = packet.executor.name;
    const handler = this.handlers[toolName];
    if (handler === undefined) {
      return buildErrorResult(packet, {
        'status': 'tool_error',
        'code': UNKNOWN_TOOL_ERROR_CODE,
        'message': `No handler is registered for tool ${toolName}.`,
        'details': { 'tool': toolName },
      });
    }

    if (typeof packet.executor.config?.command_template !== 'string') {
      return buildErrorResult(packet, {
        'status': 'tool_error',
        'code': INVALID_HANDLER_OUTPUT_ERROR_CODE,
        'message': `Tool ${toolName} is missing a valid command_template.`,
        'details': {
          'tool': toolName,
          'command_template_type': typeof packet.executor.config?.command_template,
        },
      });
    }

    const command = renderCommandTemplate(packet.executor.config.command_template, packet.inputs);
    const invocation = await this.executeWithTimeout(() => handler({
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'inputs': packet.inputs,
      'command': command,
      'executor': packet.executor,
    }), packet.executor.timeout_secs);

    if (invocation.kind === 'timeout') {
      return buildErrorResult(packet, {
        'status': 'timeout',
        'code': TOOL_HANDLER_TIMEOUT_ERROR_CODE,
        'message': `Tool ${toolName} timed out.`,
        'details': {
          'tool': toolName,
          'timeout_secs': packet.executor.timeout_secs,
        },
      });
    }

    if (invocation.kind === 'error') {
      return buildErrorResult(packet, {
        'status': 'tool_error',
        'code': TOOL_HANDLER_FAILURE_ERROR_CODE,
        'message': `Tool ${toolName} handler failed.`,
        'details': {
          'tool': toolName,
          'reason': toErrorMessage(invocation.error),
        },
      });
    }

    return validateHandlerResult(packet, toolName, invocation.result);
  }

  private async executeWithTimeout(
    task: () => Promise<ToolHandlerResult> | ToolHandlerResult,
    timeoutSecs: number,
  ): Promise<
      | { kind: 'result'; result: ToolHandlerResult }
      | { kind: 'error'; error: unknown }
      | { kind: 'timeout' }
    > {
    const safePromise = Promise.resolve()
      .then(() => task())
      .then((result) => ({ 'kind': 'result' as const, 'result': result }))
      .catch((error) => ({ 'kind': 'error' as const, 'error': error }));

    const timeoutMs = normalizeTimeoutMs(timeoutSecs);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({ 'kind': 'timeout' });
      }, timeoutMs);
    });

    const outcome = await Promise.race([safePromise, timeoutPromise]);
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    return outcome;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
