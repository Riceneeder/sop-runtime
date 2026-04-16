import {JsonObject} from './json_value';

export interface Transition {
  next_step?: string;
  terminate?: {
    run_status: 'succeeded' | 'failed' | 'cancelled';
    reason: string;
  };
}

export interface StepDefinition {
  id: string;
  title: string;
  inputs: JsonObject;
  executor: JsonObject;
  output_schema: JsonObject;
  retry_policy: JsonObject;
  supervision: {
    owner: 'main_agent';
    allowed_outcomes: Array<{
      id: string;
      description: string;
    }>;
    default_outcome: string;
  };
  transitions: Record<string, Transition>;
}

export interface SopDefinition {
  sop_id: string;
  name: string;
  version: string;
  entry_step: string;
  input_schema: JsonObject;
  policies: {
    cooldown_secs: number;
    max_run_secs: number;
    idempotency_key_template: string;
    concurrency: {
      mode: 'allow_parallel' | 'drop_if_running' | 'singleflight';
      key_template: string;
    };
  };
  steps: StepDefinition[];
  final_output: JsonObject;
  defaults?: JsonObject;
  description?: string;
  metadata?: JsonObject;
}
