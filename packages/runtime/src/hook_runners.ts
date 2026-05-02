import {
  JsonObject,
  SopDefinition,
  StepResult,
  RunState,
} from '@sop-runtime/definition';
import { buildStepPacket } from '@sop-runtime/core';
import { RuntimeError } from './runtime_error.js';
import { HostDeps } from './runtime_host_types.js';
import {
  AFTER_STEP_HOOK_RESULT_KEYS,
  AFTER_STEP_RESULT_PATCH_KEYS,
  BEFORE_STEP_HOOK_RESULT_KEYS,
  HookControl,
  assertAllowedHookKeys,
  assertHookResultObject,
  assertJsonSafeObject,
  clonePacketForHook,
  validateHookControl,
} from './hook_pipeline.js';

export async function runBeforeStepHooks(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
): Promise<{
  currentInputs: JsonObject;
  currentConfig: JsonObject | undefined;
  control: HookControl | null;
}> {
  let control: HookControl | null = null;
  let currentInputs = structuredClone(packet.inputs) as JsonObject;
  let currentConfig = structuredClone(packet.executor.config) as JsonObject | undefined;

  for (let i = 0; i < deps.beforeStepHooks.length; i += 1) {
    const hook = deps.beforeStepHooks[i]!;
    let hookResult;
    try {
      hookResult = hook({
        'packet': clonePacketForHook(packet, currentInputs, currentConfig),
        'definition': structuredClone(definition) as SopDefinition,
        state: structuredClone(state) as RunState,
      });
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'beforeStep hook threw an error.',
        'details': {
          'stage': 'beforeStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (hookResult === undefined || hookResult === null) {
      continue;
    }

    assertHookResultObject(hookResult, 'beforeStep', i);
    assertAllowedHookKeys(hookResult, BEFORE_STEP_HOOK_RESULT_KEYS, 'beforeStep', i, 'beforeStep hook result');

    if (hookResult.control !== undefined) {
      validateHookControl(hookResult.control, 'beforeStep', i);
      control = hookResult.control as HookControl;
    }
    if (hookResult.inputs !== undefined) {
      assertJsonSafeObject(hookResult.inputs, 'beforeStep', i, 'inputs');
      currentInputs = structuredClone(hookResult.inputs) as JsonObject;
    }
    if (hookResult.config !== undefined) {
      assertJsonSafeObject(hookResult.config, 'beforeStep', i, 'config');
      currentConfig = structuredClone(hookResult.config) as JsonObject;
    }
  }

  return {currentInputs, currentConfig, control};
}

export async function runAfterStepHooks(
  deps: HostDeps,
  packet: ReturnType<typeof buildStepPacket>,
  result: StepResult,
  definition: SopDefinition,
  state: RunState,
): Promise<{
  currentResult: StepResult;
  control: HookControl | null;
}> {
  let control: HookControl | null = null;
  let currentResult: StepResult = result;

  for (let i = 0; i < deps.afterStepHooks.length; i += 1) {
    const hook = deps.afterStepHooks[i]!;
    let clonedResult: StepResult;
    try {
      clonedResult = structuredClone(currentResult) as StepResult;
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'afterStep hook received a non-structured-cloneable step result.',
        'details': {
          'stage': 'afterStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }
    let hookResult;
    try {
      hookResult = hook({
        'packet': clonePacketForHook(packet, packet.inputs, packet.executor.config),
        'result': clonedResult,
        'definition': structuredClone(definition) as SopDefinition,
        state: structuredClone(state) as RunState,
      });
    } catch (err: unknown) {
      throw new RuntimeError('hook_rejected', {
        'message': 'afterStep hook threw an error.',
        'details': {
          'stage': 'afterStep',
          'index': i,
          'error': err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (hookResult === undefined || hookResult === null) {
      continue;
    }

    assertHookResultObject(hookResult, 'afterStep', i);
    assertAllowedHookKeys(hookResult, AFTER_STEP_HOOK_RESULT_KEYS, 'afterStep', i, 'afterStep hook result');

    if (hookResult.control !== undefined) {
      validateHookControl(hookResult.control, 'afterStep', i);
      control = hookResult.control as HookControl;
    }
    if (hookResult.result !== undefined) {
      assertHookResultObject(hookResult.result, 'afterStep', i);
      assertAllowedHookKeys(hookResult.result, AFTER_STEP_RESULT_PATCH_KEYS, 'afterStep', i, 'afterStep result patch');
      currentResult = {...currentResult, ...(hookResult.result as Partial<StepResult>)};
    }
  }

  return {currentResult, control};
}
