import {AcceptedStepResult, RunState} from '@sop-runtime/definition';

/**
 * Build a history entry recording that a step result was accepted.
 *
 * 构建记录步骤结果已接纳的历史条目。
 *
 * @param params - Object containing the result acceptance details.
 * @param params.step_id - The step that produced the result.
 * @param params.attempt - The attempt number.
 * @param params.result_status - The accepted result status.
 * @param params.now - Optional timestamp to attach to the entry.
 * @returns The step_result_accepted history entry.
 * @public
 */
export function buildStepResultAcceptedHistory(params: {
  step_id: string;
  attempt: number;
  result_status: AcceptedStepResult['status'];
  now?: string;
}): RunState['history'][number] {
  const entry: RunState['history'][number] = {
    'kind': 'step_result_accepted',
    'step_id': params.step_id,
    'attempt': params.attempt,
    'result_status': params.result_status,
  };

  if (params.now !== undefined) {
    return {
      ...entry,
      'at': params.now,
    };
  }

  return entry;
}
