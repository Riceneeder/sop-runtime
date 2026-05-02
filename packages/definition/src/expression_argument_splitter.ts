import { ExpressionSyntaxError } from './expression_ast.js';

export function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  const tracker = createDepthTracker(value);
  let tokenStart = 0;

  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor]!;

    if (tracker.handleChar(char)) continue;

    if (char === ',' && tracker.isTopLevel()) {
      const part = value.slice(tokenStart, cursor).trim();
      if (part.length === 0) {
        throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
      }
      parts.push(part);
      tokenStart = cursor + 1;
    }
  }

  tracker.assertBalanced(value);

  const last = value.slice(tokenStart).trim();
  if (last.length === 0 && parts.length > 0) {
    throw new ExpressionSyntaxError(`Empty coalesce argument: ${value}`);
  }
  if (last.length > 0) {
    parts.push(last);
  }

  return parts;
}

interface DepthState {
  braceDepth: number;
  bracketDepth: number;
  parenDepth: number;
  quote: '"' | '\'' | null;
  escaped: boolean;
}

function createDepthTracker(exprText: string) {
  const state: DepthState = {
    'braceDepth': 0,
    'bracketDepth': 0,
    'parenDepth': 0,
    'quote': null,
    'escaped': false,
  };

  return {
    handleChar(char: string): boolean {
      if (handleQuoteChar(state, char)) return true;
      return handleDepthChar(state, char, exprText);
    },

    isTopLevel(): boolean {
      return state.braceDepth === 0 && state.bracketDepth === 0 && state.parenDepth === 0;
    },

    assertBalanced(exprValue: string): void {
      if (state.quote !== null || state.braceDepth !== 0 || state.bracketDepth !== 0 || state.parenDepth !== 0) {
        throw new ExpressionSyntaxError(`Unbalanced expression: ${exprValue}`);
      }
    },
  };
}

function handleQuoteChar(state: DepthState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }

  if (state.quote !== null) {
    if (char === '\\') { state.escaped = true; }
    else if (char === state.quote) { state.quote = null; }
    return true;
  }

  if (char === '"' || char === '\'') {
    state.quote = char;
    return true;
  }

  return false;
}

function handleDepthChar(state: DepthState, char: string, exprText: string): boolean {
  if (char === '(') { state.parenDepth += 1; return true; }
  if (char === '[') { state.bracketDepth += 1; return true; }
  if (char === '{') { state.braceDepth += 1; return true; }

  if (char === ')') {
    if (state.parenDepth === 0) throw new ExpressionSyntaxError(`Unexpected ')' in coalesce expression: ${exprText}`);
    state.parenDepth -= 1;
    return true;
  }
  if (char === ']') {
    if (state.bracketDepth === 0) throw new ExpressionSyntaxError(`Unexpected ']' in expression: ${exprText}`);
    state.bracketDepth -= 1;
    return true;
  }
  if (char === '}') {
    if (state.braceDepth === 0) throw new ExpressionSyntaxError(`Unexpected '}' in expression: ${exprText}`);
    state.braceDepth -= 1;
    return true;
  }

  return false;
}
