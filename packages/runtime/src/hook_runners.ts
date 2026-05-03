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

/**
 * Execute all registered before-step hooks in order, collecting modifications and control actions.
 *
 * 按顺序执行所有已注册的前置步骤钩子，收集修改和控制动作。
 *
 * @param deps - The host dependencies containing beforeStep hooks.
 * @param packet - The built step packet.
 * @param definition - The SOP definition.
 * @param state - The current run state.
 * @returns The potentially modified inputs, config, and any control action.
 * @public
 */
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
    const hookResult = processBeforeHook(deps.beforeStepHooks[i]!, i, packet, definition, state, currentInputs, currentConfig);
    if (hookResult === undefined || hookResult === null) continue;

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

  return { currentInputs, currentConfig, control };
}

function processBeforeHook(
  hook: HostDeps['beforeStepHooks'][number],
  index: number,
  packet: ReturnType<typeof buildStepPacket>,
  definition: SopDefinition,
  state: RunState,
  currentInputs: JsonObject,
  currentConfig: JsonObject | undefined,
): void | Record<string, unknown> | undefined | null {
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
        'index': index,
        'error': err instanceof Error ? err.message : String(err),
      },
    });
  }

  if (hookResult !== undefined && hookResult !== null) {
    assertHookResultObject(hookResult, 'beforeStep', index);
    assertAllowedHookKeys(hookResult, BEFORE_STEP_HOOK_RESULT_KEYS, 'beforeStep', index, 'beforeStep hook result');
  }

  return hookResult;
}

/**
 * Execute all registered after-step hooks in order, collecting result modifications and control actions.
 *
 * 按顺序执行所有已注册的后置步骤钩子，收集结果修改和控制动作。
 *
 * @param deps - The host dependencies containing afterStep hooks.
 * @param packet - The built step packet.
 * @param result - The step result from the executor.
 * @param definition - The SOP definition.
 * @param state - The current run state.
 * @returns The potentially modified result and any control action.
 * @public
 */
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
    const hookResult = processAfterHook(deps.afterStepHooks[i]!, i, packet, currentResult, definition, state);
    if (hookResult === undefined || hookResult === null) continue;

    if (hookResult.control !== undefined) {
      validateHookControl(hookResult.control, 'afterStep', i);
      control = hookResult.control as HookControl;
    }
    if (hookResult.result !== undefined) {
      assertHookResultObject(hookResult.result, 'afterStep', i);
      assertAllowedHookKeys(hookResult.result, AFTER_STEP_RESULT_PATCH_KEYS, 'afterStep', i, 'afterStep result patch');
      currentResult = { ...currentResult, ...(hookResult.result as Partial<StepResult>) };
    }
  }

  return { currentResult, control };
}

function processAfterHook(
  hook: HostDeps['afterStepHooks'][number],
  index: number,
  packet: ReturnType<typeof buildStepPacket>,
  currentResult: StepResult,
  definition: SopDefinition,
  state: RunState,
): void | Record<string, unknown> | undefined | null {
  let clonedResult: StepResult;
  try {
    clonedResult = structuredClone(currentResult) as StepResult;
  } catch (err: unknown) {
    throw new RuntimeError('hook_rejected', {
      'message': 'afterStep hook received a non-structured-cloneable step result.',
      'details': {
        'stage': 'afterStep',
        'index': index,
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
        'index': index,
        'error': err instanceof Error ? err.message : String(err),
      },
    });
  }

  if (hookResult !== undefined && hookResult !== null) {
    assertHookResultObject(hookResult, 'afterStep', index);
    assertAllowedHookKeys(hookResult, AFTER_STEP_HOOK_RESULT_KEYS, 'afterStep', index, 'afterStep hook result');
  }

  return hookResult;
}
