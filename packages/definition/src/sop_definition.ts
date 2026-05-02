/**
 * SOP definition module public facade.
 *
 * Re-exports all authoring-time SOP definition types plus the root SopDefinition interface.
 *
 * SOP 定义模块公共门面：重新导出所有编排定义类型以及根 SopDefinition 接口。
 */
import {JsonObject} from './json_value.js';
import {StepDefinition} from './step_definition_types.js';

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

// Re-exports from domain-focused type modules
export type {ExecutorConfig} from './executor_types.js';
export {RETRYABLE_STEP_RESULT_STATUSES} from './policy_types.js';
export type {ResourceLimits, RetryPolicy, RetryableStepResultStatus} from './policy_types.js';
export type {StepDefinition} from './step_definition_types.js';
export type {AllowedOutcome, SupervisionConfig, Transition} from './transition_types.js';
