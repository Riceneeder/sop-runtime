import {AcceptedStepResult, AcceptedStepResultStatus} from './execution';
import {JsonObject} from './json_value';

export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export const RUN_PHASES = ['ready', 'awaiting_decision', 'terminated'] as const;
export const STEP_LIFECYCLES = [
  'pending',
  'active',
  'waiting_decision',
  'completed',
  'failed',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunPhase = (typeof RUN_PHASES)[number];
export type StepLifecycle = (typeof STEP_LIFECYCLES)[number];

export interface StepState {
  step_id: string;
  status: StepLifecycle;
  attempt_count: number;
  last_result_status?: AcceptedStepResultStatus;
  last_outcome_id?: string;
}

export type HistoryEntry =
  | {
    kind: 'run_created';
    at?: string;
    step_id: string;
  }
  | {
    kind: 'step_result_accepted';
    at?: string;
    step_id: string;
    attempt: number;
    result_status: AcceptedStepResultStatus;
  }
  | {
    kind: 'decision_applied';
    at?: string;
    step_id: string;
    attempt: number;
    outcome_id: string;
  }
  | {
    kind: 'run_terminated';
    at?: string;
    run_status: Exclude<RunStatus, 'running'>;
    reason: string;
  };

export interface RunState {
  run_id: string;
  sop_id: string;
  sop_version: string;
  status: RunStatus;
  phase: RunPhase;
  run_input: JsonObject;
  entry_step_id: string;
  current_step_id: string | null;
  current_attempt: number | null;
  steps: Record<string, StepState>;
  accepted_results: Record<string, AcceptedStepResult | undefined>;
  history: HistoryEntry[];
  terminal?: {
    run_status: Exclude<RunStatus, 'running'>;
    reason: string;
  };
  created_at?: string;
  updated_at?: string;
}
