import {
  JsonObject,
  RunState,
  SopDefinition,
  StepResult,
} from '@sop-runtime/definition';
import { StateStore } from './state_store.js';
import { DecisionProvider } from './decision_provider.js';
import { EventSink } from './event_sink.js';
import { Clock } from './clock.js';
import {
  AfterStepHook,
  BeforeStepHook,
} from './hook_pipeline.js';

/**
 * Internal dependencies aggregated by RuntimeHost for its execution flow.
 *
 * RuntimeHost 为其执行流程聚合的内部依赖。
 *
 * @public
 */
export interface HostDeps {
  /** Persistence layer for run state. 运行状态的持久化层。 */
  store: StateStore;
  /** Provider for automatic decision making. 自动决策提供者。 */
  decisionProvider: DecisionProvider;
  /** System clock for timestamps. 用于时间戳的系统时钟。 */
  clock: Clock;
  /** Event sink for runtime events. 运行时事件的事件接收器。 */
  eventSink: EventSink;
  /** Registered executor handlers grouped by kind then name. 按 kind→name 分组的已注册执行器处理器。 */
  executors: Map<string, Map<string, ExecutorHandler>>;
  /** Hooks that run before each step execution. 每一步执行前运行的钩子。 */
  beforeStepHooks: BeforeStepHook[];
  /** Hooks that run after each step execution. 每一步执行后运行的钩子。 */
  afterStepHooks: AfterStepHook[];
}

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
