/**
 * Expression module public facade.
 *
 * Re-exports all expression-related types, the syntax error class, and parser functions.
 *
 * 表达式模块公共门面：重新导出所有表达式相关类型、语法错误类及解析函数。
 */
export {
  ExpressionSyntaxError,
} from './expression_ast.js';
export type {
  CoalesceExpression,
  ExpressionLiteral,
  ExpressionNode,
  ExpressionReference,
  ExpressionSegment,
  TemplateSegment,
  TextSegment,
} from './expression_ast.js';
export {parseExpressionBody} from './expression_body_parser.js';
export {parseExpressionTemplate} from './template_parser.js';
