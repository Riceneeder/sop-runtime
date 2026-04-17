import {JsonObject} from './json_value';

export interface Transition {
  next_step?: string;
  terminate?: {
    run_status: 'succeeded' | 'failed' | 'cancelled';
    reason: string;
  };
}

export interface AllowedOutcome {
  id: string;
  description: string;
}

export interface SupervisionConfig {
  owner: 'main_agent';
  allowed_outcomes: AllowedOutcome[];
  default_outcome: string;
}

export const RETRYABLE_STEP_RESULT_STATUSES = [
  'timeout',
  'tool_error',
  'invalid_output',
  'sandbox_error',
] as const;

export type RetryableStepResultStatus = (typeof RETRYABLE_STEP_RESULT_STATUSES)[number];

export interface RetryPolicy {
  max_attempts: number;
  backoff_secs: number[];
  retry_on: RetryableStepResultStatus[];
}

export interface ResourceLimits {
  max_output_bytes: number;
  max_artifacts: number;
}

interface BaseExecutorConfig {
  path: string;
  timeout_secs: number;
  allow_network: boolean;
  env: Record<string, string>;
  resource_limits: ResourceLimits;
}

export interface SandboxToolExecutorConfig extends BaseExecutorConfig {
  kind: 'sandbox_tool';
  tool: string;
  command_template: string;
}

export interface SandboxScriptExecutorConfig extends BaseExecutorConfig {
  kind: 'sandbox_script';
  tool: string;
  command_template: string;
}

export interface SandboxModelExecutorConfig extends BaseExecutorConfig {
  kind: 'sandbox_model';
  model: string;
  prompt_template: string;
}

export type ExecutorConfig =
  | SandboxToolExecutorConfig
  | SandboxScriptExecutorConfig
  | SandboxModelExecutorConfig;

export interface StepDefinition {
  id: string;
  title: string;
  inputs: JsonObject;
  executor: ExecutorConfig;
  output_schema: JsonObject;
  retry_policy: RetryPolicy;
  supervision: SupervisionConfig;
  transitions: Record<string, Transition>;
  description?: string;
  metadata?: JsonObject;
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
