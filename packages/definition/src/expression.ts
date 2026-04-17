import {JsonValue} from './json_value';

export interface ExpressionLiteral {
  kind: 'literal';
  value: JsonValue;
}

export interface ExpressionReference {
  kind: 'reference';
  source: 'run_input' | 'step_output' | 'step_artifacts';
  step_id?: string;
  path: string[];
  raw: string;
}

export interface CoalesceExpression {
  kind: 'coalesce';
  expressions: ExpressionNode[];
}

export type ExpressionNode = CoalesceExpression | ExpressionLiteral | ExpressionReference;

export interface ExpressionSegment {
  kind: 'expression';
  expression: ExpressionNode;
}

export interface TextSegment {
  kind: 'text';
  value: string;
}

export type TemplateSegment = ExpressionSegment | TextSegment;

export class ExpressionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionSyntaxError';
  }
}

export function parseExpressionTemplate(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf('${', cursor);
    if (start === -1) {
      if (cursor < template.length) {
        segments.push({
          'kind': 'text',
          'value': template.slice(cursor),
        });
      }
      break;
    }

    if (start > cursor) {
      segments.push({
        'kind': 'text',
        'value': template.slice(cursor, start),
      });
    }

    const end = findTemplateExpressionEnd(template, start + 2);
    const body = template.slice(start + 2, end).trim();
    segments.push({
      'kind': 'expression',
      'expression': parseExpressionBody(body),
    });
    cursor = end + 1;
  }

  if (segments.length === 0) {
    return [{
      'kind': 'text',
      'value': template,
    }];
  }

  return segments;
}

export function parseExpressionBody(body: string): ExpressionNode {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new ExpressionSyntaxError('Empty expression body.');
  }

  if (trimmed.startsWith('coalesce(')) {
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

  const literal = parseLiteral(trimmed);
  if (literal !== undefined) {
    return {
      'kind': 'literal',
      'value': literal,
    };
  }

  if (trimmed.startsWith('run.input.')) {
    return {
      'kind': 'reference',
      'source': 'run_input',
      'path': parsePath(trimmed.slice('run.input.'.length), body),
      'raw': trimmed,
    };
  }

  if (trimmed.startsWith('steps.')) {
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

  throw new ExpressionSyntaxError(`Unsupported expression: ${body}`);
}

function findTemplateExpressionEnd(template: string, start: number): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let cursor = start; cursor < template.length; cursor += 1) {
    const char = template[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      if (parenDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ')' in template: ${template}`);
      }
      parenDepth -= 1;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      if (bracketDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ']' in template: ${template}`);
      }
      bracketDepth -= 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      if (braceDepth > 0) {
        braceDepth -= 1;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0) {
        return cursor;
      }
    }
  }

  throw new ExpressionSyntaxError(`Unclosed expression in template: ${template}`);
}

function parseLiteral(value: string): JsonValue | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
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

function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  let tokenStart = 0;

  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      if (parenDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ')' in coalesce expression: ${value}`);
      }
      parenDepth -= 1;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      if (bracketDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected ']' in expression: ${value}`);
      }
      bracketDepth -= 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      if (braceDepth === 0) {
        throw new ExpressionSyntaxError(`Unexpected '}' in expression: ${value}`);
      }
      braceDepth -= 1;
      continue;
    }

    if (char === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const part = value.slice(tokenStart, cursor).trim();
      if (part.length === 0) {
        throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
      }
      parts.push(part);
      tokenStart = cursor + 1;
    }
  }

  if (quote !== null || braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) {
    throw new ExpressionSyntaxError(`Unbalanced expression: ${value}`);
  }

  const last = value.slice(tokenStart).trim();
  if (last.length === 0 && parts.length > 0) {
    throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
  }
  if (last.length > 0) {
    parts.push(last);
  }

  return parts;
}
