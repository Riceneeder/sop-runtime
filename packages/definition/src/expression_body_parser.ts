import { JsonValue } from './json_value.js';
import { ExpressionNode, ExpressionSyntaxError } from './expression_ast.js';
import { splitTopLevelArguments } from './expression_argument_splitter.js';

/**
 * Parse an expression body string into an ExpressionNode AST, dispatching to reference, coalesce, or literal parsers.
 *
 * 将表达式体字符串解析为 ExpressionNode AST，分发到引用、coalesce 或字面量解析器。
 *
 * @param body - The raw expression body string (without `${}` delimiters).
 * @returns The parsed expression AST node.
 * @throws {ExpressionSyntaxError} If the expression is malformed or unsupported.
 * @public
 */
export function parseExpressionBody(body: string): ExpressionNode {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new ExpressionSyntaxError('Empty expression body.');
  }

  if (trimmed.startsWith('coalesce(')) {
    return parseCoalesce(trimmed, body);
  }

  const literal = parseLiteral(trimmed);
  if (literal !== undefined) {
    return { 'kind': 'literal', 'value': literal };
  }

  if (trimmed.startsWith('run.input.')) {
    return parseRunInputReference(trimmed, body);
  }

  if (trimmed.startsWith('steps.')) {
    return parseStepReference(trimmed, body);
  }

  throw new ExpressionSyntaxError(`Unsupported expression: ${body}`);
}

function parseCoalesce(trimmed: string, body: string): ExpressionNode {
  if (!trimmed.endsWith(')')) {
    throw new ExpressionSyntaxError(`Malformed coalesce expression: ${body}`);
  }

  const inner = trimmed.slice('coalesce('.length, -1);
  const parts = splitTopLevelArguments(inner);
  if (parts.length === 0) {
    throw new ExpressionSyntaxError(`coalesce() requires at least one argument: ${body}`);
  }

  return {
    'kind': 'coalesce',
    'expressions': parts.map((part) => parseExpressionBody(part)),
  };
}

function parseRunInputReference(trimmed: string, body: string): ExpressionNode {
  return {
    'kind': 'reference',
    'source': 'run_input',
    'path': parsePath(trimmed.slice('run.input.'.length), body),
    'raw': trimmed,
  };
}

function parseStepReference(trimmed: string, body: string): ExpressionNode {
  const parts = trimmed.split('.');
  if (parts.length < 4) {
    throw new ExpressionSyntaxError(`Incomplete step reference: ${body}`);
  }

  const [, stepId, source, ...path] = parts;
  if (!stepId) {
    throw new ExpressionSyntaxError(`Step reference is missing a step id: ${body}`);
  }
  if (source !== 'output' && source !== 'artifacts') {
    throw new ExpressionSyntaxError(`Unsupported step reference source: ${body}`);
  }
  if (path.length === 0 || path.some((part) => part.length === 0)) {
    throw new ExpressionSyntaxError(`Step reference is missing a field path: ${body}`);
  }

  return {
    'kind': 'reference',
    'source': source === 'output' ? 'step_output' : 'step_artifacts',
    'step_id': stepId,
    'path': path,
    'raw': trimmed,
  };
}

function parseLiteral(value: string): JsonValue | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('[') && value.endsWith(']'))
    || (value.startsWith('{') && value.endsWith('}'))
  ) {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      throw new ExpressionSyntaxError(`Invalid JSON literal: ${value}`);
    }
  }

  return undefined;
}

function parsePath(value: string, body: string): string[] {
  const path = value.split('.');
  if (path.length === 0 || path.some((part) => part.length === 0)) {
    throw new ExpressionSyntaxError(`Reference is missing a field path: ${body}`);
  }

  return path;
}
