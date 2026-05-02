/**
 * Split a template string into text and expression segments.
 *
 * 把模板字符串拆分为普通文本片段与表达式片段。
 */
import {ExpressionSyntaxError, TemplateSegment} from './expression_ast.js';
import {parseExpressionBody} from './expression_body_parser.js';

/**
 * Split a template string into text and expression segments.
 *
 * 把模板字符串拆分为普通文本片段与表达式片段。
 *
 * @param template - Raw template string containing zero or more `${...}` sections.
 * 包含零个或多个 `${...}` 片段的原始模板字符串。
 * @returns Parsed segment list in source order.
 * 按源码顺序排列的解析后片段列表。
 *
 * @public
 */
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

/**
 * Find the closing brace for a `${...}` expression while respecting nesting.
 *
 * 在考虑引号与嵌套结构的前提下定位 `${...}` 的结束大括号。
 *
 * @param template - Whole template string being parsed.
 * 当前正在解析的完整模板字符串。
 * @param start - Cursor position immediately after the opening `${`.
 * 起始游标位置，位于 `${` 之后。
 * @returns Index of the matching closing brace.
 * 与之匹配的结束大括号下标。
 * @throws {@link ExpressionSyntaxError}
 * 当表达式未闭合或出现非法括号配对时抛出。
 */
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
