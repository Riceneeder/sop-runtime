import {CoreStepPacket as RuntimeStepPacket} from '@sop-runtime/core';
import {StepResult} from '@sop-runtime/definition';

export type ExecutorResult = StepResult;
export type {RuntimeStepPacket};

/** Adapter boundary for sandbox, tool, agent, or local command execution. 沙箱、工具、代理或本地命令执行的适配边界。 */
export interface StepExecutor {
  /** Executes one current-step packet and returns a raw step result for core validation. 执行一条当前步骤数据包，并返回供 core 校验的原始步骤结果。 */
  execute(packet: RuntimeStepPacket): Promise<ExecutorResult>;
}
