/**
 * Execution-time payloads exchanged between runtime components.
 *
 * 运行时组件之间交换的执行阶段数据结构。
 */
import {ExecutorConfig} from './sop_definition.js';
import {JsonObject} from './json_value.js';

/**
 * Result statuses accepted into persistent run history.
 *
 * 可写入持久化运行历史的步骤结果状态。
 *
 * @public
 */
export const ACCEPTED_STEP_RESULT_STATUSES = [
  'success',
  'timeout',
  'tool_error',
  'sandbox_error',
  'invalid_output',
] as const;

/**
 * Raw executor statuses emitted before supervision decisions.
 *
 * 执行器原始输出的状态集合。
 *
 * @public
 */
export const EXECUTOR_RESULT_STATUSES = [
  'success',
  'timeout',
  'tool_error',
  'sandbox_error',
] as const;

/**
 * Union of raw executor statuses.
 *
 * 执行器原始状态的联合类型。
 *
 * @public
 */
export type ExecutorResultStatus = (typeof EXECUTOR_RESULT_STATUSES)[number];

/**
 * Union of accepted step-result statuses.
 *
 * 已接纳步骤结果状态的联合类型。
 *
 * @public
 */
export type AcceptedStepResultStatus = (typeof ACCEPTED_STEP_RESULT_STATUSES)[number];

/**
 * Structured error payload attached to step execution data.
 *
 * 绑定在步骤执行数据上的结构化错误负载。
 *
 * @public
 */
export interface StepError {
  /** Stable machine-readable error code. 机器可读且稳定的错误编码。 */
  code: string;
  /** Human-readable explanation for operators. 面向操作者的可读错误说明。 */
  message: string;
  /** Structured error payload for debugging or automation. 便于调试或自动化处理的结构化详情。 */
  details?: JsonObject;
}

/**
 * Normalized step result that the orchestration engine accepted.
 *
 * 被编排引擎接纳并进入正式状态机的步骤结果。
 *
 * @public
 */
export interface AcceptedStepResult {
  /** Step identifier that produced the accepted result. 产出该结果的步骤标识。 */
  step_id: string;
  /** Attempt number accepted by the orchestration engine. 被编排引擎接纳的尝试次数。 */
  attempt: number;
  /** Final accepted status for this attempt. 当前尝试最终被接纳的状态。 */
  status: AcceptedStepResultStatus;
  /** Structured output captured from the executor. 从执行器采集到的结构化输出。 */
  output?: JsonObject;
  /** Named artifact references produced by the step. 步骤产出的命名制品引用。 */
  artifacts?: Record<string, string>;
  /** Error payload when the attempt did not succeed cleanly. 当尝试未正常成功时的错误信息。 */
  error?: StepError | null;
  /** Optional execution metrics such as durations or token usage. 可选执行指标，例如耗时或 token 消耗。 */
  metrics?: JsonObject;
}

/**
 * Raw result emitted directly by an executor.
 *
 * 执行器直接产出的原始步骤结果。
 *
 * @public
 */
export interface StepResult {
  /** Run identifier that owns the attempt. 归属该尝试的运行标识。 */
  run_id: string;
  /** Step identifier being executed. 当前执行的步骤标识。 */
  step_id: string;
  /** Attempt number produced by the executor. 执行器产出的尝试次数。 */
  attempt: number;
  /** Immediate executor status before supervision. 监督决策之前的原始执行状态。 */
  status: ExecutorResultStatus;
  /** Structured output payload from the executor. 执行器返回的结构化输出。 */
  output?: JsonObject;
  /** Artifact map emitted by the executor. 执行器产出的制品映射。 */
  artifacts?: Record<string, string>;
  /** Structured error payload if execution failed. 执行失败时的结构化错误信息。 */
  error?: StepError | null;
  /** Optional metrics emitted by the executor. 执行器附带的可选指标。 */
  metrics?: JsonObject;
}

/**
 * Supervision decision applied to a specific step attempt.
 *
 * 应用于某个步骤尝试的监督决策。
 *
 * @public
 */
export interface Decision {
  /** Run identifier this decision belongs to. 该监督决策所属的运行标识。 */
  run_id: string;
  /** Step identifier under review. 正在被审查的步骤标识。 */
  step_id: string;
  /** Attempt number the decision applies to. 该决策对应的尝试次数。 */
  attempt: number;
  /** Outcome chosen by the supervisor. 监督者选定的 outcome 标识。 */
  outcome_id: string;
  /** Optional operator-facing rationale. 面向操作者的可选决策理由。 */
  reason?: string;
  /** Extra metadata attached to the decision. 附加在决策上的补充元数据。 */
  metadata?: JsonObject;
}

/**
 * Resolved execution packet delivered to an executor.
 *
 * 发送给执行器的已解析执行数据包。
 *
 * @public
 */
export interface StepPacket {
  /** Run identifier passed to the executor. 传递给执行器的运行标识。 */
  run_id: string;
  /** Step identifier passed to the executor. 传递给执行器的步骤标识。 */
  step_id: string;
  /** Attempt number that should be executed. 当前需要执行的尝试次数。 */
  attempt: number;
  /** Resolved step inputs after template expansion. 模板展开后的最终步骤输入。 */
  inputs: JsonObject;
  /** Executor configuration that determines how the step runs. 决定步骤运行方式的执行器配置。 */
  executor: ExecutorConfig;
  /** Output schema expected from the executor. 执行器应返回的输出结构约束。 */
  output_schema: JsonObject;
}

/**
 * Canonical top-level output emitted when a run terminates successfully.
 *
 * 运行结束后产出的标准顶层结果。
 *
 * @public
 */
export type FinalOutput = JsonObject;

/**
 * Historical record for one concrete step attempt within a run.
 *
 * 一次运行中某个具体步骤尝试的历史记录。
 *
 * @public
 */
export interface StepRun {
  /** Run identifier for the historical entry. 历史记录所属的运行标识。 */
  run_id: string;
  /** Step identifier for the historical entry. 历史记录关联的步骤标识。 */
  step_id: string;
  /** Attempt number captured in history. 历史记录中捕获的尝试次数。 */
  attempt: number;
  /** Resolved executor request payload, if persisted. 持久化保存的执行器请求内容。 */
  executor_request?: JsonObject;
  /** Raw executor result, if the attempt reached execution. 若尝试进入执行阶段则记录原始结果。 */
  executor_result?: StepResult;
  /** Supervisor decision applied to the attempt, if any. 若存在监督决策则记录其内容。 */
  supervisor_decision?: Decision;
  /** Transition applied after the decision. 决策之后真正生效的状态转移。 */
  transition?: {
    /** Outcome id that selected the transition. 触发该转移的 outcome 标识。 */
    outcome_id: string;
    /** Next step id when execution continues. 运行继续时跳转到的下一步骤标识。 */
    next_step_id?: string;
    /** Terminal run state when the transition stops the run. 转移导致运行终止时的终态信息。 */
    terminated?: {
      run_status: 'succeeded' | 'failed' | 'cancelled';
      reason: string;
    };
  };
}
