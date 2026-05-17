import { CoreStepPacket } from '@sop-runtime/core';
import { JsonObject, RunState, SopDefinition, StepResult } from '@sop-runtime/definition';

/**
 * Resolved step execution packet from core.
 *
 * core 解析后的步骤执行数据包。
 *
 * @public
 */
export type RuntimeStepPacket = CoreStepPacket;

/**
 * Raw step result returned by an executor adapter.
 *
 * 执行器适配器返回的原始步骤结果。
 *
 * @public
 */
export type ExecutorResult = StepResult;

/**
 * Input provided to an ExecutorHandler when a step is dispatched.
 *
 * 步骤分发时提供给 ExecutorHandler 的输入。
 *
 * @public
 */
export interface ExecutorHandlerInput {
  /** The resolved step execution packet. 已解析的步骤执行数据包。 */
  packet: {
    /** Run identifier. 运行标识符。 */
    run_id: string;
    /** Step identifier. 步骤标识符。 */
    step_id: string;
    /** Current attempt number. 当前尝试次数。 */
    attempt: number;
    /** Resolved step inputs. 已解析的步骤输入。 */
    inputs: JsonObject;
    /** Optional output schema for validation. 可选的输出 schema 用于校验。 */
    output_schema?: JsonObject;
    /** Executor configuration. 执行器配置。 */
    executor: {
      kind: string;
      name: string;
      config?: JsonObject;
      timeout_secs: number;
      allow_network: boolean;
      env: Record<string, string>;
      resource_limits: {
        max_output_bytes: number;
        max_artifacts: number;
      };
    };
  };
  /** The SOP definition. SOP 定义。 */
  definition: SopDefinition;
  /** Current run state. 当前运行状态。 */
  state: RunState;
  /** Executor-specific config resolved from the step definition. 从步骤定义解析的执行器特定配置。 */
  config: JsonObject;
  /** Optional AbortSignal for cancelling in-flight execution. 用于取消正在执行的操作的可选 AbortSignal。 */
  signal?: AbortSignal;
}

/**
 * Function signature for a registered executor handler.
 *
 * 已注册执行器处理器的函数签名。
 *
 * @param input - The executor handler input containing the packet, definition, state, and config.
 * @returns The step result, either synchronously or as a promise.
 * @public
 */
export type ExecutorHandler = (input: ExecutorHandlerInput) => Promise<StepResult> | StepResult;

/**
 * Adapter boundary for sandbox, tool, agent, or local command execution.
 *
 * 沙箱、工具、代理或本地命令执行的适配边界。
 *
 * @public
 */
export interface StepExecutor {
  /** Executes one current-step packet and returns a raw step result for core validation. 执行一条当前步骤数据包，并返回供 core 校验的原始步骤结果。 */
  execute(packet: RuntimeStepPacket): Promise<ExecutorResult>;
}

/**
 * Full adapter descriptor with metadata.
 *
 * 包含元数据的完整适配器描述。
 *
 * @public
 */
export interface ExecutorAdapter {
  /** The executor kind (e.g. "shell", "agent", "http"). 执行器类型。 */
  kind: string;
  /** The executor name within the kind. 执行器名称。 */
  name: string;
  /** Human-readable description. 人类可读的描述。 */
  description?: string;
  /** The handler function. 处理函数。 */
  handler: ExecutorHandler;
}

/**
 * Registration entry for an executor adapter.
 *
 * 执行器适配器的注册条目。
 *
 * @public
 */
export type ExecutorAdapterRegistration = ExecutorAdapter;

/**
 * Config template resolver signature.
 *
 * 配置模板解析器签名。
 *
 * @public
 */
export type ExecutorConfigResolver = (config: JsonObject, run: RunState) => JsonObject;
