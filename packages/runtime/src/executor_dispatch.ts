import {
  SopDefinition,
  StepResult,
  RunState,
} from '@sop-runtime/definition';
import { buildStepPacket } from '@sop-runtime/core';
import { RuntimeError } from './runtime_error.js';
import { HostDeps, ExecutorHandlerInput } from './runtime_host_types.js';
import { executeHandlerWithTimeout, enforceResourceLimits } from './executor_enforcer.js';

/**
 * Dispatch a built step packet to the registered executor handler, with timeout enforcement and resource limit checks.
 *
 * 将构建好的步骤数据包分发到已注册的执行器处理器，包含超时强制执行和资源限制检查。
 *
 * @param deps - The host dependencies containing registered executors.
 * @param packet - The built step packet from buildStepPacket.
 * @param definition - The SOP definition.
 * @param state - The current run state.
 * @returns The step result from the executor.
 * @throws {RuntimeError} If no executor handler is registered.
 * @public
 */
export async function dispatchExecutor(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): Promise<StepResult> {
  const handler = deps.executors.get(packet.executor.kind)?.get(packet.executor.name);
  if (handler === undefined) {
    throw new RuntimeError('executor_not_registered', {
      'message': `No executor registered for ${packet.executor.kind}:${packet.executor.name}.`,
      'details': {
        'kind': packet.executor.kind,
        'name': packet.executor.name,
      },
    });
  }

  const resourceLimits = structuredClone(packet.executor.resource_limits);

  const invocation = await executeHandlerWithTimeout(
    () => handler(buildHandlerInput(packet, definition, state)),
    packet.executor.timeout_secs,
  );

  if (invocation.kind === 'timeout') {
    return buildTimeoutResult(packet);
  }

  if (invocation.kind === 'error') {
    throw invocation.error;
  }

  return enforceResourceLimits({
    'result': invocation.result,
    'resourceLimits': resourceLimits,
    'runId': packet.run_id,
    'stepId': packet.step_id,
    'attempt': packet.attempt,
  });
}

function buildHandlerInput(
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): ExecutorHandlerInput {
  const clonedExecutor = structuredClone(packet.executor);
  return {
    packet: {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'inputs': structuredClone(packet.inputs),
      'output_schema': packet.output_schema !== undefined ? structuredClone(packet.output_schema) : undefined,
      'executor': clonedExecutor,
    },
    definition: structuredClone(definition) as SopDefinition,
    state: structuredClone(state) as RunState,
    'config': clonedExecutor.config ?? {},
  };
}

function buildTimeoutResult(packet: ReturnType<typeof buildStepPacket>): StepResult {
  return {
    'run_id': packet.run_id,
    'step_id': packet.step_id,
    'attempt': packet.attempt,
    'status': 'timeout',
    'error': {
      'code': 'executor_timeout',
      'message': `Executor ${packet.executor.kind}:${packet.executor.name} timed out after ${packet.executor.timeout_secs} seconds.`,
      'details': {
        'timeout_secs': packet.executor.timeout_secs,
      },
    },
  };
}
