import {RunState} from '@sop-runtime/definition';

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
