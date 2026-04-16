import {CoreStepPacket} from '@sop-exec/core';

export interface ExecutorResult {
  run_id: string;
  step_id: string;
  attempt: number;
  status: 'success' | 'timeout' | 'tool_error' | 'sandbox_error';
  output?: Record<string, unknown>;
}

export interface StepExecutor {
  execute(packet: CoreStepPacket): Promise<ExecutorResult>;
}
