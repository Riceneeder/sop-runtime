import {ExecutorConfig} from './sop_definition';
import {JsonObject} from './json_value';

export const ACCEPTED_STEP_RESULT_STATUSES = [
  'success',
  'timeout',
  'tool_error',
  'sandbox_error',
  'invalid_output',
] as const;

export const EXECUTOR_RESULT_STATUSES = [
  'success',
  'timeout',
  'tool_error',
  'sandbox_error',
] as const;

export type ExecutorResultStatus = (typeof EXECUTOR_RESULT_STATUSES)[number];
export type AcceptedStepResultStatus = (typeof ACCEPTED_STEP_RESULT_STATUSES)[number];

export interface StepError {
  code: string;
  message: string;
  details?: JsonObject;
}

export interface AcceptedStepResult {
  step_id: string;
  attempt: number;
  status: AcceptedStepResultStatus;
  output?: JsonObject;
  artifacts?: Record<string, string>;
  error?: StepError | null;
  metrics?: JsonObject;
}

export interface StepResult {
  run_id: string;
  step_id: string;
  attempt: number;
  status: ExecutorResultStatus;
  output?: JsonObject;
  artifacts?: Record<string, string>;
  error?: StepError | null;
  metrics?: JsonObject;
}

export interface Decision {
  run_id: string;
  step_id: string;
  attempt: number;
  outcome_id: string;
  reason?: string;
  metadata?: JsonObject;
}

export interface StepPacket {
  run_id: string;
  step_id: string;
  attempt: number;
  inputs: JsonObject;
  executor: ExecutorConfig;
  output_schema: JsonObject;
}

export type FinalOutput = JsonObject;

export interface StepRun {
  run_id: string;
  step_id: string;
  attempt: number;
  executor_request?: JsonObject;
  executor_result?: StepResult;
  supervisor_decision?: Decision;
  transition?: {
    outcome_id: string;
    next_step_id?: string;
    terminated?: {
      run_status: 'succeeded' | 'failed' | 'cancelled';
      reason: string;
    };
  };
}
