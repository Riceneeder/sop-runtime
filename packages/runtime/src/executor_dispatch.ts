import {
  SopDefinition,
  StepResult,
  RunState,
} from '@sop-runtime/definition';
import { buildStepPacket } from '@sop-runtime/core';
import { RuntimeError } from './runtime_error.js';
import { HostDeps, ExecutorHandlerInput } from './runtime_host_types.js';
import { executeHandlerWithTimeout, enforceResourceLimits } from './executor_enforcer.js';

export async function dispatchExecutor(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): Promise<StepResult> {
  const inner = deps.executors.get(packet.executor.kind);
  const handler = inner?.get(packet.executor.name);
  if (handler === undefined) {
    throw new RuntimeError('executor_not_registered', {
      'message': `No executor registered for ${packet.executor.kind}:${packet.executor.name}.`,
      'details': {
        'kind': packet.executor.kind,
        'name': packet.executor.name,
      },
    });
  }

  const handlerInput: ExecutorHandlerInput = {
    packet: {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'inputs': packet.inputs,
      'output_schema': packet.output_schema !== undefined ? structuredClone(packet.output_schema) : undefined,
      'executor': packet.executor,
    },
    definition: structuredClone(definition) as SopDefinition,
    state: structuredClone(state) as RunState,
    'config': packet.executor.config ?? {},
  };

  const invocation = await executeHandlerWithTimeout(
    () => handler(handlerInput),
    packet.executor.timeout_secs,
  );

  if (invocation.kind === 'timeout') {
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

  if (invocation.kind === 'error') {
    throw invocation.error;
  }

  return enforceResourceLimits({
    'result': invocation.result,
    'resourceLimits': packet.executor.resource_limits,
    'runId': packet.run_id,
    'stepId': packet.step_id,
    'attempt': packet.attempt,
  });
}
