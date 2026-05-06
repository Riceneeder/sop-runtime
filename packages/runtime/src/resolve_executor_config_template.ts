import {evaluateExpressionTemplate} from '@sop-runtime/core';
import {JsonObject, JsonValue, RunState} from '@sop-runtime/definition';

export interface ResolveExecutorConfigTemplateParams {
  config: JsonObject;
  context: {
    run: RunState;
  };
}

export function resolveExecutorConfigTemplate(params: ResolveExecutorConfigTemplateParams): JsonObject {
  return resolveJsonValue(params.config, params.context.run) as JsonObject;
}

function resolveJsonValue(value: JsonValue, run: RunState): JsonValue {
  if (typeof value === 'string') {
    return evaluateExpressionTemplate({'template': value, state: run});
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveJsonValue(item, run));
  }
  if (isJsonObject(value)) {
    const resolved: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      resolved[key] = resolveJsonValue(item, run);
    }
    return resolved;
  }
  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
