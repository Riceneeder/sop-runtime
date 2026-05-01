/**
 * Authoring-time SOP definition types consumed by the validator and runtime.
 *
 * 供校验器与运行时共享的 SOP 编排定义类型。
 */
import {JsonObject} from './json_value.js';

/**
 * Transition selected after a supervised outcome is applied.
 *
 * 监督 outcome 生效后执行的转移定义。
 *
 * @public
 */
export interface Transition {
  /**
   * Next step id when the workflow should continue.
   *
   * 工作流继续执行时跳转的下一步骤标识。
   */
  next_step?: string;
  /**
   * Terminal state to apply when the workflow should stop.
   *
   * 工作流需要结束时应用的终态信息。
   */
  terminate?: {
    run_status: 'succeeded' | 'failed' | 'cancelled';
    reason: string;
  };
}

/**
 * Supervision outcome that can be chosen for a step attempt.
 *
 * 步骤尝试可被监督者选择的 outcome。
 *
 * @public
 */
export interface AllowedOutcome {
  /**
   * Stable identifier referenced by transitions and decisions.
   *
   * 被转移规则和监督决策引用的稳定标识。
   */
  id: string;
  /**
   * Human-readable explanation shown to operators.
   *
   * 面向操作者展示的可读说明。
   */
  description: string;
}

/**
 * Human supervision configuration for a step definition.
 *
 * 步骤定义中的人工监督配置。
 *
 * @public
 */
export interface SupervisionConfig {
  /**
   * Actor responsible for approving the step result.
   *
   * 负责批准步骤结果的监督主体。
   */
  owner: 'main_agent';
  /**
   * Outcome choices the supervisor may select from.
   *
   * 监督者可以选择的 outcome 列表。
   */
  allowed_outcomes: AllowedOutcome[];
  /**
   * Fallback outcome id used when no explicit decision is made.
   *
   * 未显式决策时使用的默认 outcome。
   */
  default_outcome: string;
}

/**
 * Step result statuses that are eligible for retry.
 *
 * 可用于触发重试策略的步骤结果状态集合。
 *
 * @public
 */
export const RETRYABLE_STEP_RESULT_STATUSES = [
  'timeout',
  'tool_error',
  'invalid_output',
  'sandbox_error',
] as const;

/**
 * Union of statuses accepted by {@link RetryPolicy.retry_on}.
 *
 * {@link RetryPolicy.retry_on} 可使用的状态联合类型。
 *
 * @public
 */
export type RetryableStepResultStatus = (typeof RETRYABLE_STEP_RESULT_STATUSES)[number];

/**
 * Retry configuration for a step.
 *
 * 单个步骤的重试策略配置。
 *
 * @public
 */
export interface RetryPolicy {
  /**
   * Maximum total attempts, including the first execution.
   *
   * 最大总尝试次数，包含首次执行。
   */
  max_attempts: number;
  /**
   * Delay schedule in seconds between retries.
   *
   * 每次重试之间的延迟秒数序列。
   */
  backoff_secs: number[];
  /**
   * Result statuses that are eligible for retry.
   *
   * 允许触发重试的结果状态集合。
   */
  retry_on: RetryableStepResultStatus[];
}

/**
 * Resource ceilings enforced for one executor attempt.
 *
 * 单次执行器尝试需要遵守的资源上限。
 *
 * @public
 */
export interface ResourceLimits {
  /**
   * Maximum serialized output size accepted from the executor.
   *
   * 执行器输出允许的最大序列化字节数。
   */
  max_output_bytes: number;
  /**
   * Maximum number of artifacts the executor may emit.
   *
   * 执行器允许产出的最大制品数量。
   */
  max_artifacts: number;
}

/**
 * Generic executor configuration referenced by kind + name.
 *
 * Executor handlers are registered externally via RuntimeHost.registerExecutor(kind, name, handler).
 * The SOP definition only references executors — it does not embed their implementation details.
 *
 * 通用执行器配置，通过 kind + name 引用外部注册的 handler。
 */
export interface ExecutorConfig {
  /**
   * Executor kind used to look up the registered handler.
   *
   * 用于查找已注册 handler 的执行器种类。
   */
  kind: string;
  /**
   * Executor name used to look up the registered handler.
   *
   * 用于查找已注册 handler 的执行器名称。
   */
  name: string;
  /**
   * Optional configuration forwarded to the registered handler.
   *
   * 转发给已注册 handler 的可选配置。
   */
  config?: JsonObject;
  /**
   * Hard timeout for a single attempt, in seconds.
   *
   * 单次尝试的硬超时时间，单位为秒。
   */
  timeout_secs: number;
  /**
   * Whether the executor may access the network.
   *
   * 执行器是否允许访问网络。
   */
  allow_network: boolean;
  /**
   * Environment variables injected into the executor.
   *
   * 注入执行器的环境变量映射。
   */
  env: Record<string, string>;
  /**
   * Resource ceilings enforced for the executor.
   *
   * 对执行器施加的资源上限。
   */
  resource_limits: ResourceLimits;
}

/**
 * One author-defined step inside a SOP workflow.
 *
 * SOP 工作流中由作者声明的单个步骤定义。
 *
 * @public
 */
export interface StepDefinition {
  /**
   * Stable step identifier used in transitions and expressions.
   *
   * 被转移规则和表达式引用的稳定步骤标识。
   */
  id: string;
  /**
   * Human-readable step title shown in tools and UIs.
   *
   * 在工具与界面中展示的人类可读标题。
   */
  title: string;
  /**
   * Input object template resolved before execution.
   *
   * 执行前需要解析的输入对象模板。
   */
  inputs: JsonObject;
  /**
   * Executor configuration describing how the step runs.
   *
   * 描述步骤如何执行的执行器配置。
   */
  executor: ExecutorConfig;
  /**
   * JSON Schema-like contract for the executor output.
   *
   * 约束执行器输出的类 JSON Schema 结构。
   */
  output_schema: JsonObject;
  /**
   * Retry behavior for failed or invalid attempts.
   *
   * 失败或无效尝试时的重试行为配置。
   */
  retry_policy: RetryPolicy;
  /**
   * Human-in-the-loop supervision requirements.
   *
   * 人在回路中的监督配置。
   */
  supervision: SupervisionConfig;
  /**
   * Outcome-to-transition mapping applied after supervision.
   *
   * 监督结束后按 outcome 选择的转移表。
   */
  transitions: Record<string, Transition>;
  /**
   * Optional longer description for operators and authors.
   *
   * 面向作者和操作者的可选长描述。
   */
  description?: string;
  /**
   * Optional arbitrary metadata attached to the step.
   *
   * 附加在步骤上的可选任意元数据。
   */
  metadata?: JsonObject;
}

/**
 * Root authoring model for one SOP workflow definition.
 *
 * 单个 SOP 工作流定义的根对象模型。
 *
 * @public
 */
export interface SopDefinition {
  /**
   * Stable identifier for the SOP itself.
   *
   * SOP 定义自身的稳定标识。
   */
  sop_id: string;
  /**
   * Human-readable SOP name.
   *
   * 面向人展示的 SOP 名称。
   */
  name: string;
  /**
   * Semantic version string for the SOP.
   *
   * SOP 的语义化版本号。
   */
  version: string;
  /**
   * Identifier of the first step to execute.
   *
   * 运行开始时要进入的第一个步骤标识。
   */
  entry_step: string;
  /**
   * Schema describing the allowed run input payload.
   *
   * 描述运行输入结构的模式定义。
   */
  input_schema: JsonObject;
  /**
   * Execution-wide policies applied to every run.
   *
   * 对每次运行统一生效的全局策略。
   */
  policies: {
    /**
     * Cooldown window in seconds between runs.
     *
     * 两次运行之间的冷却时间，单位为秒。
     */
    cooldown_secs: number;
    /**
     * Maximum allowed run duration in seconds.
     *
     * 单次运行允许的最大持续时间，单位为秒。
     */
    max_run_secs: number;
    /**
     * Template used to derive the idempotency key.
     *
     * 用于生成幂等键的模板。
     */
    idempotency_key_template: string;
    /**
     * Concurrency control settings for overlapping runs.
     *
     * 多个运行重叠时的并发控制配置。
     */
    concurrency: {
      /**
       * Concurrency mode selected for the SOP.
       *
       * 为该 SOP 选择的并发策略模式。
       */
      mode: 'allow_parallel' | 'drop_if_running' | 'singleflight';
      /**
       * Template used to derive the concurrency key.
       *
       * 用于生成并发控制键的模板。
       */
      key_template: string;
    };
  };
  /**
   * Ordered list of step definitions in the workflow.
   *
   * 工作流中按作者顺序声明的步骤列表。
   */
  steps: StepDefinition[];
  /**
   * Template object that defines the final run output.
   *
   * 定义运行最终输出结构的模板对象。
   */
  final_output: JsonObject;
  /**
   * Optional default values for run input resolution.
   *
   * 解析运行输入时可使用的默认值。
   */
  defaults?: JsonObject;
  /**
   * Optional long-form description for the SOP.
   *
   * SOP 的可选长描述。
   */
  description?: string;
  /**
   * Optional arbitrary metadata attached to the SOP.
   *
   * 附加在 SOP 上的可选任意元数据。
   */
  metadata?: JsonObject;
}
