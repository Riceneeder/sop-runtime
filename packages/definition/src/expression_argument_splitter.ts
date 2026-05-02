/**
 * Split `coalesce(...)` arguments without breaking nested JSON or function calls.
 *
 * 拆分 `coalesce(...)` 参数，同时避免误切分嵌套 JSON 或函数调用。
 */
import {ExpressionSyntaxError} from './expression_ast.js';

/**
 * Split `coalesce(...)` arguments without breaking nested JSON or function calls.
 *
 * 拆分 `coalesce(...)` 参数，同时避免误切分嵌套 JSON 或函数调用。
 *
 * @param value - Raw comma-separated argument list inside `coalesce(...)`.
 * `coalesce(...)` 内部原始的逗号分隔参数串。
 * @returns Parsed top-level argument strings.
 * 解析得到的顶层参数字符串列表。
 * @throws {@link ExpressionSyntaxError}
 * 当参数存在空项或括号结构不平衡时抛出。
 */
export function splitTopLevelArguments(value: string): string[] {
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
