import {RunState} from '@sop-runtime/definition';

/**
 * Build a history entry recording that a supervision decision was applied.
 *
 * 构建记录监督决策已应用的历史条目。
 *
 * @param params - Object containing the decision details.
 * @param params.step_id - The step targeted by the decision.
 * @param params.attempt - The attempt number when the decision was made.
 * @param params.outcome_id - The outcome identifier chosen by the decision.
 * @param params.now - Optional timestamp to attach to the entry.
 * @returns The decision_applied history entry.
 * @public
 */
export function buildDecisionAppliedHistory(params: {
  step_id: string;
  attempt: number;
  outcome_id: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'decision_applied',
    'step_id': params.step_id,
    'attempt': params.attempt,
    'outcome_id': params.outcome_id,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}

/**
 * Build a history entry recording that the run was terminated.
 *
 * 构建记录运行已终止的历史条目。
 *
 * @param params - Object containing the termination details.
 * @param params.run_status - The final run status (e.g. cancelled, failed).
 * @param params.reason - Human-readable termination reason.
 * @param params.now - Optional timestamp to attach to the entry.
 * @returns The run_terminated history entry.
 * @public
 */
export function buildRunTerminatedHistory(params: {
  run_status: Exclude<RunState['status'], 'running'>;
  reason: string;
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'run_terminated',
    'run_status': params.run_status,
    'reason': params.reason,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}
