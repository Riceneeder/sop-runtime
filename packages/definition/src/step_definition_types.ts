/**
 * Step definition type for a single SOP workflow step.
 *
 * SOP 工作流单个步骤的定义类型。
 */
import {JsonObject} from './json_value.js';
import {ExecutorConfig} from './executor_types.js';
import {RetryPolicy} from './policy_types.js';
import {SupervisionConfig, Transition} from './transition_types.js';

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
