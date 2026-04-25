import {
  ExpressionNode,
  JsonObject,
  JsonValue,
  RunState,
  parseExpressionTemplate,
} from '@sop-runtime/definition';
import {CoreError} from './core_error.js';

interface MissingExpressionValueDetails {
  expression: string;
  segment?: string;
}

class MissingExpressionValueError extends Error {
  readonly details: MissingExpressionValueDetails;

  constructor(message: string, details: MissingExpressionValueDetails) {
    super(message);
    this.name = 'MissingExpressionValueError';
    this.details = details;
  }
}

export function evaluateExpressionTemplate(params: {
  template: string;
  state: RunState;
}): JsonValue {
  try {
    const segments = parseExpressionTemplate(params.template);
    if (segments.length === 1) {
      const segment = segments[0];
      if (!segment) {
        throw new CoreError('expression_evaluation_failed', {
          'message': 'Expression template parsing returned no segments.',
          'details': {'template': params.template},
        });
      }
      if (segment.kind === 'text') {
        return segment.value;
      }

      const result = evaluateExpressionNode(segment.expression, params.state);
      return typeof result === 'object' && result !== null ? structuredClone(result) : result;
    }

    let rendered = '';
    for (const segment of segments) {
      if (segment.kind === 'text') {
        rendered += segment.value;
        continue;
      }

      const value = evaluateExpressionNode(segment.expression, params.state);
      rendered += stringifyTemplateValue(value);
    }

    return rendered;
  } catch (error: unknown) {
    throw toExpressionError(error, {'template': params.template});
  }
}

export function renderJsonValueTemplates(params: {
  value: JsonValue;
  state: RunState;
}): JsonValue {
  if (typeof params.value === 'string') {
    return evaluateExpressionTemplate({
      'template': params.value,
      'state': params.state,
    });
  }

  if (Array.isArray(params.value)) {
    return params.value.map((item) => {
      return renderJsonValueTemplates({
        'value': item,
        'state': params.state,
      });
    });
  }

  if (isPlainObject(params.value)) {
    const rendered: JsonObject = {};
    for (const [key, value] of Object.entries(params.value)) {
      rendered[key] = renderJsonValueTemplates({
        value,
        'state': params.state,
      });
    }
    return rendered;
  }

  return params.value;
}

function evaluateExpressionNode(node: ExpressionNode, state: RunState): JsonValue {
  if (node.kind === 'literal') {
    return node.value;
  }

  if (node.kind === 'coalesce') {
    for (const candidate of node.expressions) {
      try {
        return evaluateExpressionNode(candidate, state);
      } catch (error: unknown) {
        if (isMissingExpressionValueError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new MissingExpressionValueError('All coalesce candidates are missing.', {
      'expression': stringifyExpressionNode(node),
    });
  }

  return evaluateReferenceNode(node, state);
}

function evaluateReferenceNode(node: Extract<ExpressionNode, {kind: 'reference'}>, state: RunState): JsonValue {
  if (node.source === 'run_input') {
    return readPath(state.run_input, node.path, node.raw);
  }

  const stepId = node.step_id;
  if (!stepId) {
    throw new CoreError('expression_evaluation_failed', {
      'message': 'Step reference is missing a step id.',
      'details': {'expression': node.raw},
    });
  }

  const acceptedResult = state.accepted_results[stepId];
  if (acceptedResult === undefined) {
    throw new MissingExpressionValueError(`No accepted result for step "${stepId}".`, {
      'expression': node.raw,
      'segment': stepId,
    });
  }

  if (node.source === 'step_output') {
    if (acceptedResult.output === undefined) {
      throw new MissingExpressionValueError(`Step "${stepId}" has no accepted output.`, {
        'expression': node.raw,
        'segment': stepId,
      });
    }

    return readPath(acceptedResult.output, node.path, node.raw);
  }

  if (acceptedResult.artifacts === undefined) {
    throw new MissingExpressionValueError(`Step "${stepId}" has no accepted artifacts.`, {
      'expression': node.raw,
      'segment': stepId,
    });
  }

  return readPath(acceptedResult.artifacts, node.path, node.raw);
}

function readPath(root: unknown, path: string[], expression: string): JsonValue {
  let current: unknown = root;

  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        throw new MissingExpressionValueError(`Array index "${segment}" is missing in "${expression}".`, {
          expression,
          segment,
        });
      }

      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        throw new MissingExpressionValueError(`Array index "${segment}" is out of bounds in "${expression}".`, {
          expression,
          segment,
        });
      }

      current = current[index];
      continue;
    }

    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      throw new MissingExpressionValueError(`Path segment "${segment}" is missing in "${expression}".`, {
        expression,
        segment,
      });
    }

    current = current[segment];
  }

  if (current === undefined) {
    throw new MissingExpressionValueError(`Expression "${expression}" resolved to an undefined value.`, {
      expression,
    });
  }

  if (!isJsonValue(current)) {
    throw new CoreError('expression_evaluation_failed', {
      'message': `Expression "${expression}" resolved to a non-JSON value.`,
      'details': {'expression': expression},
    });
  }

  return current;
}

function stringifyTemplateValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function stringifyExpressionNode(node: ExpressionNode): string {
  if (node.kind === 'literal') {
    return JSON.stringify(node.value);
  }
  if (node.kind === 'reference') {
    return node.raw;
  }

  const renderedChildren = node.expressions.map((item) => stringifyExpressionNode(item));
  return `coalesce(${renderedChildren.join(', ')})`;
}

function toExpressionError(error: unknown, details: Record<string, unknown>): CoreError {
  if (error instanceof CoreError) {
    return error;
  }

  if (isMissingExpressionValueError(error)) {
    return new CoreError('expression_evaluation_failed', {
      'message': error.message,
      'details': {
        ...details,
        'expression': error.details.expression,
        'segment': error.details.segment,
      },
    });
  }

  if (error instanceof Error) {
    return new CoreError('expression_evaluation_failed', {
      'message': error.message,
      details,
    });
  }

  return new CoreError('expression_evaluation_failed', {
    'message': 'Expression evaluation failed.',
    details,
  });
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }

  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMissingExpressionValueError(error: unknown): error is MissingExpressionValueError {
  return error instanceof MissingExpressionValueError;
}
