import {
  JsonObject,
  RunState,
  SopDefinition,
  StepResult,
} from '@sop-runtime/definition';
import { StateStore } from './state_store.js';
import { DecisionProvider } from './decision_provider.js';
import { EventSink } from './event_sink.js';
import { Clock } from './clock.js';
import {
  AfterStepHook,
  BeforeStepHook,
} from './hook_pipeline.js';

export interface HostDeps {
  store: StateStore;
  decisionProvider: DecisionProvider;
  clock: Clock;
  eventSink: EventSink;
  executors: Map<string, Map<string, ExecutorHandler>>;
  beforeStepHooks: BeforeStepHook[];
  afterStepHooks: AfterStepHook[];
}

export interface ExecutorHandlerInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
    output_schema?: JsonObject;
    executor: {
      kind: string;
      name: string;
      config?: JsonObject;
      timeout_secs: number;
      allow_network: boolean;
      env: Record<string, string>;
      resource_limits: {
        max_output_bytes: number;
        max_artifacts: number;
      };
    };
  };
  definition: SopDefinition;
  state: RunState;
  config: JsonObject;
}

export type ExecutorHandler = (input: ExecutorHandlerInput) => Promise<StepResult> | StepResult;
