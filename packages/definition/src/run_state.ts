/**
 * Runtime state snapshots that describe how a SOP run progresses.
 *
 * 描述 SOP 运行过程演进的运行时状态快照。
 */
import {AcceptedStepResult, AcceptedStepResultStatus} from './execution';
import {JsonObject} from './json_value';

/**
 * Terminal lifecycle status for an entire run.
 *
 * 整个运行实例的终态与进行中状态集合。
 *
 * @public
 */
export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
/**
 * High-level orchestration phase for the current run.
 *
 * 当前运行所处的高层编排阶段。
 *
 * @public
 */
export const RUN_PHASES = ['ready', 'awaiting_decision', 'terminated'] as const;
/**
 * Fine-grained lifecycle status for an individual step.
 *
 * 单个步骤在运行中的细粒度生命周期状态。
 *
 * @public
 */
export const STEP_LIFECYCLES = [
  'pending',
  'active',
  'waiting_decision',
  'completed',
  'failed',
] as const;

/**
 * Union of top-level run statuses.
 *
 * 顶层运行状态的联合类型。
 *
 * @public
 */
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Union of orchestration phases for a run.
 *
 * 运行编排阶段的联合类型。
 *
 * @public
 */
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * Union of step lifecycle statuses.
 *
 * 步骤生命周期状态的联合类型。
 *
 * @public
 */
export type StepLifecycle = (typeof STEP_LIFECYCLES)[number];

/**
 * Mutable per-step state tracked inside a run snapshot.
 *
 * 运行快照里按步骤维护的可变状态。
 *
 * @public
 */
export interface StepState {
  /** Step identifier tracked in the run graph. 运行图中被跟踪的步骤标识。 */
  step_id: string;
  /** Current lifecycle status for the step. 当前步骤所处的生命周期状态。 */
  status: StepLifecycle;
  /** Number of attempts that have been started for the step. 该步骤已启动的尝试次数。 */
  attempt_count: number;
  /** Most recent accepted result status, if one exists. 最近一次被接纳的结果状态。 */
  last_result_status?: AcceptedStepResultStatus;
  /** Most recent outcome chosen by supervision, if any. 最近一次监督选择的 outcome。 */
  last_outcome_id?: string;
}

/**
 * Append-only history entries used to reconstruct run progress.
 *
 * 用于回放运行过程的追加型历史事件。
 *
 * @public
 */
export type HistoryEntry =
  | {
    /** Creation event emitted when the run is initialized. 运行初始化时写入的创建事件。 */
    kind: 'run_created';
    /** Optional timestamp for the event. 事件发生时间戳，可选。 */
    at?: string;
    /** Entry step selected for the run. 本次运行选择的入口步骤。 */
    step_id: string;
  }
  | {
    /** Event emitted when a step result is accepted. 步骤结果被接纳时写入的事件。 */
    kind: 'step_result_accepted';
    /** Optional timestamp for the event. 事件发生时间戳，可选。 */
    at?: string;
    /** Step that produced the accepted result. 产生被接纳结果的步骤。 */
    step_id: string;
    /** Attempt number accepted into history. 被记录进历史的尝试次数。 */
    attempt: number;
    /** Accepted result status for that attempt. 该尝试被接纳后的结果状态。 */
    result_status: AcceptedStepResultStatus;
  }
  | {
    /** Event emitted after a supervision decision is applied. 监督决策生效后写入的事件。 */
    kind: 'decision_applied';
    /** Optional timestamp for the event. 事件发生时间戳，可选。 */
    at?: string;
    /** Step reviewed by the decision. 被该决策审查的步骤。 */
    step_id: string;
    /** Attempt number targeted by the decision. 该决策对应的尝试次数。 */
    attempt: number;
    /** Outcome id chosen by the supervisor. 监督者选定的 outcome 标识。 */
    outcome_id: string;
  }
  | {
    /** Event emitted when the run terminates. 运行终止时写入的事件。 */
    kind: 'run_terminated';
    /** Optional timestamp for the event. 事件发生时间戳，可选。 */
    at?: string;
    /** Final terminal status for the run. 运行结束后的终态状态。 */
    run_status: Exclude<RunStatus, 'running'>;
    /** Human-readable explanation for termination. 终止原因的可读描述。 */
    reason: string;
  };

/**
 * Canonical runtime snapshot for an in-flight or finished SOP run.
 *
 * 进行中或已结束 SOP 运行的标准运行时快照。
 *
 * @public
 */
export interface RunState {
  /** Unique identifier for the current run instance. 当前运行实例的唯一标识。 */
  run_id: string;
  /** SOP identifier copied from the definition. 从定义复制而来的 SOP 标识。 */
  sop_id: string;
  /** SOP version copied from the definition. 从定义复制而来的 SOP 版本。 */
  sop_version: string;
  /** Current top-level run status. 当前运行的顶层状态。 */
  status: RunStatus;
  /** Current orchestration phase. 当前编排阶段。 */
  phase: RunPhase;
  /** Original run input payload. 本次运行的原始输入数据。 */
  run_input: JsonObject;
  /** Entry step resolved when the run started. 运行启动时解析出的入口步骤。 */
  entry_step_id: string;
  /** Step currently being executed or reviewed. 当前正在执行或等待审查的步骤。 */
  current_step_id: string | null;
  /** Attempt number currently in flight. 当前正在处理的尝试次数。 */
  current_attempt: number | null;
  /** Per-step state indexed by step id. 以步骤标识索引的逐步状态表。 */
  steps: Record<string, StepState>;
  /** Latest accepted result per step id. 按步骤标识保存的最新接纳结果。 */
  accepted_results: Record<string, AcceptedStepResult | undefined>;
  /** Ordered event history for the run. 按时间顺序保存的运行事件历史。 */
  history: HistoryEntry[];
  /** Final terminal payload when the run has ended. 运行结束后保存的终态信息。 */
  terminal?: {
    run_status: Exclude<RunStatus, 'running'>;
    reason: string;
  };
  /** Optional creation timestamp. 创建时间戳，可选。 */
  created_at?: string;
  /** Optional last-update timestamp. 最后更新时间戳，可选。 */
  updated_at?: string;
}
