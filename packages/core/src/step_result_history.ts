import {AcceptedStepResult, RunState} from '@sop-runtime/definition';

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
