/**
 * Template value traversal and syntax diagnostic conversion.
 *
 * 模板值的遍历及语法诊断信息转换。
 */
import {ExpressionSyntaxError, parseExpressionTemplate} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';
import {ExpressionValidationContext, ExpressionValidationOptions} from './expression_reference_validator.js';
import {validateExpressionNode} from './expression_reference_validator.js';

/**
 * Walk arbitrary JSON-like values and validate any string templates found within.
 *
 * 遍历任意 JSON 风格值，并校验其中出现的字符串模板。
 */
export function visitTemplateValue(
  value: unknown,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  if (typeof value === 'string') {
    validateTemplate(value, path, context, diagnostics, options);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitTemplateValue(item, joinPath(path, index), context, diagnostics, options));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      visitTemplateValue(item, joinPath(path, key), context, diagnostics, options);
    }
  }
}

/**
 * Parse a template and validate every embedded expression segment.
 *
 * 解析模板字符串，并校验其中每个嵌入表达式片段。
 */
function validateTemplate(
  template: string,
  path: string,
  context: ExpressionValidationContext,
  diagnostics: Diagnostic[],
  options: ExpressionValidationOptions = {},
): void {
  try {
    const segments = parseExpressionTemplate(template);
    for (const segment of segments) {
      if (segment.kind === 'expression') {
        validateExpressionNode(segment.expression, path, context, diagnostics, options);
      }
    }
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      pushExpressionSyntaxDiagnostic(error, path, diagnostics);
      return;
    }

    throw error;
  }
}

/**
 * Convert parser syntax errors into user-facing diagnostics.
 *
 * 把解析器抛出的语法错误转换为用户可见的诊断信息。
 */
function pushExpressionSyntaxDiagnostic(error: ExpressionSyntaxError, path: string, diagnostics: Diagnostic[]): void {
  diagnostics.push({
    'code': 'expression_syntax',
    'message': error.message,
    'path': path,
  });
}
