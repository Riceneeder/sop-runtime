/**
 * Transition, supervision, and outcome types for step definitions.
 *
 * 步骤定义的转移、监督与 outcome 类型。
 */

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
