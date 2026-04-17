import {CoreStepPacket} from '@sop-exec/core';
import {StepResult} from '@sop-exec/definition';

export type ExecutorResult = StepResult;

export interface StepExecutor {
  execute(packet: CoreStepPacket): Promise<ExecutorResult>;
}
