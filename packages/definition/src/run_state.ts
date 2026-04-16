import {JsonObject} from './json_value';

export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export const RUN_PHASES = ['ready', 'awaiting_decision', 'terminated'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunPhase = (typeof RUN_PHASES)[number];

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
}
