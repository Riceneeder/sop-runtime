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

/**
 * Input provided to a ToolHandler for tool execution.
 *
 * 提供给 ToolHandler 用于工具执行的输入。
 *
 * @public
 */
export interface ToolHandlerInput {
  /** Run identifier. 运行标识符。 */
  run_id: string;
  /** Step identifier. 步骤标识符。 */
  step_id: string;
  /** Current attempt number. 当前尝试次数。 */
  attempt: number;
  /** Resolved step inputs. 已解析的步骤输入。 */
  inputs: JsonObject;
  /** Rendered command string from the command_template. 从 command_template 渲染的命令字符串。 */
  command: string;
  /** Executor configuration from the step definition. 步骤定义中的执行器配置。 */
  executor: RuntimeStepPacket['executor'];
}

/**
 * Result returned by a ToolHandler.
 *
 * ToolHandler 返回的结果。
 *
 * @public
 */
export interface ToolHandlerResult {
  /** Optional structured output. 可选的结构化输出。 */
  output?: JsonObject;
  /** Optional string-string artifact map. 可选的字符串到字符串制品映射。 */
  artifacts?: Record<string, string>;
  /** Optional structured metrics. 可选的结构化度量。 */
  metrics?: JsonObject;
}

/**
 * Function signature for a registered tool handler.
 *
 * 已注册工具处理器的函数签名。
 *
 * @param input - The tool handler input.
 * @returns The tool handler result.
 * @public
 */
export type ToolHandler = (input: ToolHandlerInput) => Promise<ToolHandlerResult> | ToolHandlerResult;

/**
 * Options for constructing a ToolRegistryExecutor.
 *
 * ToolRegistryExecutor 的构造选项。
 *
 * @public
 */
export interface ToolRegistryExecutorOptions {
  /** Map of tool names to their handler functions. 工具名称到处理函数映射。 */
  handlers: Record<string, ToolHandler>;
}

/**
 * StepExecutor implementation that dispatches sandbox_tool packets to named tool handlers.
 *
 * 将 sandbox_tool 数据包分发到命名工具处理器的 StepExecutor 实现。
 *
 * @public
 */
export class ToolRegistryExecutor implements StepExecutor {
  private readonly handlers: Record<string, ToolHandler>;

  /**
   * @param options - The options containing the handler map.
   */
  constructor(options: ToolRegistryExecutorOptions) {
    this.handlers = { ...options.handlers };
  }

  /**
   * Execute a step by dispatching to the appropriate tool handler.
   *
   * 执行步骤，将任务分发到对应的工具处理器。
   *
   * @param packet - The runtime step packet describing the tool to execute.
   * @returns The step result from the tool handler.
   */
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
