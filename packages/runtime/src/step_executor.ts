import {CoreStepPacket as RuntimeStepPacket} from '@sop-runtime/core';
import {StepResult} from '@sop-runtime/definition';

export type ExecutorResult = StepResult;
export type {RuntimeStepPacket};

/** Adapter boundary for sandbox, tool, agent, or local command execution. */
export interface StepExecutor {
  /** Executes one current-step packet and returns a raw step result for core validation. */
  execute(packet: RuntimeStepPacket): Promise<ExecutorResult>;
}
