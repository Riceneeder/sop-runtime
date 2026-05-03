import {JsonObject, RunState, SopDefinition, StepResult} from '@sop-runtime/definition';
import {buildStepPacket} from '@sop-runtime/core';
import {RuntimeError} from './runtime_error.js';

/**
 * Hook control signalling that the hook wants to pause or terminate the run.
 *
 * 钩子控制信号，表示钩子想要暂停或终止运行。
 *
 * @public
 */
export type HookControl =
  | { action: 'pause'; reason: string }
  | { action: 'terminate'; runStatus: 'failed' | 'cancelled'; reason: string };

/**
 * Input provided to a BeforeStep hook function.
 *
 * 提供给 BeforeStep 钩子函数的输入。
 *
 * @public
 */
export interface BeforeStepHookInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
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
}

/**
 * Function signature for a BeforeStep hook.
 *
 * BeforeStep 钩子的函数签名。
 *
 * @param input - The hook input containing the packet, definition, and state.
 * @returns Optional modifications to inputs, config, or a control action.
 * @public
 */
export type BeforeStepHook = (
  input: BeforeStepHookInput,
) => void | { inputs?: JsonObject; config?: JsonObject; control?: HookControl };

/**
 * Input provided to an AfterStep hook function.
 *
 * 提供给 AfterStep 钩子函数的输入。
 *
 * @public
 */
export interface AfterStepHookInput {
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
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
  result: StepResult;
  definition: SopDefinition;
  state: RunState;
}

/**
 * Function signature for an AfterStep hook.
 *
 * AfterStep 钩子的函数签名。
 *
 * @param input - The hook input containing the packet, result, definition, and state.
 * @returns Optional modifications to the result fields, or a control action.
 * @public
 */
export type AfterStepHook = (
  input: AfterStepHookInput,
) => void | { result?: Partial<Pick<StepResult, 'status' | 'output' | 'artifacts' | 'error' | 'metrics'>>; control?: HookControl };

/** Allowed keys for BeforeStep hook return values. BeforeStep 钩子返回值允许的键。 */
export const BEFORE_STEP_HOOK_RESULT_KEYS = new Set(['inputs', 'config', 'control']);
/** Allowed keys for AfterStep hook return values. AfterStep 钩子返回值允许的键。 */
export const AFTER_STEP_HOOK_RESULT_KEYS = new Set(['result', 'control']);
/** Allowed keys for AfterStep hook result patches. AfterStep 钩子结果补丁允许的键。 */
export const AFTER_STEP_RESULT_PATCH_KEYS = new Set(['status', 'output', 'artifacts', 'error', 'metrics']);

/**
 * Clone a step packet into the shape expected by hook functions, with optional overrides for inputs and config.
 *
 * 克隆步骤数据包为钩子函数期望的形状，支持可选的输入和配置覆盖。
 *
 * @param packet - The built step packet from buildStepPacket.
 * @param inputs - The (possibly hook-modified) inputs.
 * @param config - The (possibly hook-modified) executor config.
 * @returns A clone of the packet suitable for hook input.
 * @public
 */
export function clonePacketForHook(
  packet: ReturnType<typeof buildStepPacket>,
  inputs: JsonObject,
  config: JsonObject | undefined,
): BeforeStepHookInput['packet'] {
  const packetForHook = {
    'run_id': packet.run_id,
    'step_id': packet.step_id,
    'attempt': packet.attempt,
    inputs,
    'executor': {
      'kind': packet.executor.kind,
      'name': packet.executor.name,
      'config': config,
      'timeout_secs': packet.executor.timeout_secs,
      'allow_network': packet.executor.allow_network,
      'env': packet.executor.env,
      'resource_limits': packet.executor.resource_limits,
    },
  };

  return structuredClone(packetForHook) as BeforeStepHookInput['packet'];
}

/**
 * Assert that a hook return value is a plain object.
 *
 * 断言钩子返回值为普通对象。
 *
 * @param value - The value to check.
 * @param stage - The hook stage (beforeStep or afterStep).
 * @param index - The hook index for error diagnostics.
 * @throws {RuntimeError} If the value is not a plain object.
 * @public
 */
export function assertHookResultObject(
  value: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
): asserts value is Record<string, unknown> {
  if (isStrictPlainObject(value)) {
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': `${stage} hook must return an object when it returns a value.`,
    'details': {stage, index},
  });
}

/**
 * Assert that an object only contains allowed keys.
 *
 * 断言对象只包含允许的键。
 *
 * @param value - The object to check.
 * @param allowedKeys - The set of allowed keys.
 * @param stage - The hook stage for error diagnostics.
 * @param index - The hook index for error diagnostics.
 * @param container - The container name for error diagnostics.
 * @throws {RuntimeError} If any key is not allowed.
 * @public
 */
export function assertAllowedHookKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  stage: 'beforeStep' | 'afterStep',
  index: number,
  container: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new RuntimeError('hook_rejected', {
        'message': `${container} returned unsupported field: ${key}.`,
        'details': {stage, index, 'field': key},
      });
    }
  }
}

/**
 * Assert that a value is a JSON-safe object.
 *
 * 断言值为 JSON 安全的对象。
 *
 * @param value - The value to check.
 * @param stage - The hook stage for error diagnostics.
 * @param index - The hook index for error diagnostics.
 * @param field - The field name for error diagnostics.
 * @throws {RuntimeError} If the value is not JSON-safe.
 * @public
 */
export function assertJsonSafeObject(
  value: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
  field: string,
): asserts value is JsonObject {
  if (isJsonSafeObject(value, new Set<object>())) {
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': `${stage} hook returned non JSON-safe ${field}.`,
    'details': {stage, index, field},
  });
}

function isJsonSafeObject(value: unknown, seen: Set<object>): value is JsonObject {
  if (!isStrictPlainObject(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }

  seen.add(value);
  for (const item of Object.values(value)) {
    if (!isJsonSafeValue(item, seen)) {
      seen.delete(value);
      return false;
    }
  }
  seen.delete(value);

  return true;
}

function isJsonSafeValue(value: unknown, seen: Set<object>): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return isJsonSafeArray(value, seen);
  }

  return isJsonSafeObject(value, seen);
}

function isJsonSafeArray(arr: unknown[], seen: Set<object>): boolean {
  if (seen.has(arr)) {
    return false;
  }
  seen.add(arr);
  for (let i = 0; i < arr.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(arr, i) || !isJsonSafeValue(arr[i], seen)) {
      seen.delete(arr);
      return false;
    }
  }
  seen.delete(arr);
  return true;
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validate that a hook control object has the correct shape for its action type.
 *
 * 校验钩子控制对象对于其动作类型具有正确的形状。
 *
 * @param control - The control object to validate.
 * @param stage - The hook stage for error diagnostics.
 * @param index - The hook index for error diagnostics.
 * @throws {RuntimeError} If the control shape is invalid.
 * @public
 */
export function validateHookControl(
  control: unknown,
  stage: 'beforeStep' | 'afterStep',
  index: number,
): asserts control is HookControl {
  if (!isStrictPlainObject(control)) {
    throw new RuntimeError('hook_rejected', {
      'message': 'Hook control must be a non-null object.',
      'details': {stage, index},
    });
  }

  const c = control;
  if (c.action === 'pause') {
    assertAllowedHookKeys(c, new Set(['action', 'reason']), stage, index, 'hook pause control');
    if (typeof c.reason !== 'string') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook pause control requires a string reason.',
        'details': {stage, index},
      });
    }
    return;
  }

  if (c.action === 'terminate') {
    assertAllowedHookKeys(c, new Set(['action', 'runStatus', 'reason']), stage, index, 'hook terminate control');
    if (c.runStatus !== 'failed' && c.runStatus !== 'cancelled') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook terminate control requires runStatus of "failed" or "cancelled".',
        'details': {stage, index},
      });
    }
    if (typeof c.reason !== 'string') {
      throw new RuntimeError('hook_rejected', {
        'message': 'Hook terminate control requires a string reason.',
        'details': {stage, index},
      });
    }
    return;
  }

  throw new RuntimeError('hook_rejected', {
    'message': 'Hook control action must be "pause" or "terminate".',
    'details': {stage, index},
  });
}
