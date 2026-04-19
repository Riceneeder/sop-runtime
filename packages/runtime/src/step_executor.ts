import {CoreStepPacket} from '@sop-runtime/core';
import {StepResult} from '@sop-runtime/definition';

export type ExecutorResult = StepResult;

export interface StepExecutor {
  execute(packet: CoreStepPacket): Promise<ExecutorResult>;
}
