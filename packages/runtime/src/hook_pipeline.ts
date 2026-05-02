import {JsonObject, RunState, SopDefinition, StepResult} from '@sop-runtime/definition';
import {buildStepPacket} from '@sop-runtime/core';
import {RuntimeError} from './runtime_error.js';

/** Hook control signalling that the hook wants to pause or terminate the run. */
export type HookControl =
  | { action: 'pause'; reason: string }
  | { action: 'terminate'; runStatus: 'failed' | 'cancelled'; reason: string };

/** BeforeStep hooks receive the built packet and may rewrite inputs or config, or request a control action. */
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

export type BeforeStepHook = (
  input: BeforeStepHookInput,
) => void | { inputs?: JsonObject; config?: JsonObject; control?: HookControl };

/** AfterStep hooks receive the executor result and may rewrite result fields, or request a control action. */
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

export type AfterStepHook = (
  input: AfterStepHookInput,
) => void | { result?: Partial<Pick<StepResult, 'status' | 'output' | 'artifacts' | 'error' | 'metrics'>>; control?: HookControl };

export const BEFORE_STEP_HOOK_RESULT_KEYS = new Set(['inputs', 'config', 'control']);
export const AFTER_STEP_HOOK_RESULT_KEYS = new Set(['result', 'control']);
export const AFTER_STEP_RESULT_PATCH_KEYS = new Set(['status', 'output', 'artifacts', 'error', 'metrics']);

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
