/**
 * Top-level validator composition for SOP definitions.
 *
 * SOP 定义顶层校验入口，负责串联所有校验阶段。
 */
import {SopDefinition} from '@sop-runtime/definition';
import {Diagnostic, ValidationResult} from './diagnostic.js';
import {validateExpressionDefinition} from './expression_validator.js';
import {validateSchemaDefinition} from './schema_validator.js';
import {validateSemanticDefinition} from './semantic_validator.js';

/**
 * Run schema, semantic, and expression validation in a fixed order.
 *
 * 以固定顺序执行结构、语义和表达式校验。
 *
 * @param definition - SOP definition value to validate.
 * 待校验的 SOP 定义对象。
 * @returns Aggregated validation result with all discovered diagnostics.
 * 聚合所有诊断信息后的校验结果。
 *
 * @public
 */
export function validateDefinition(definition: SopDefinition): ValidationResult {
  const normalizedDefinition = isPlainObject(definition)
    ? definition
    : {} as SopDefinition;

  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(definition)) {
    diagnostics.push({'code': 'schema_type', 'message': 'Expected object.', 'path': ''});
  }

  diagnostics.push(
    ...validateSchemaDefinition(normalizedDefinition),
    ...validateSemanticDefinition(normalizedDefinition),
    ...validateExpressionDefinition(normalizedDefinition),
  );

  return {
    'ok': diagnostics.length === 0,
    diagnostics,
  };
}

/**
 * Narrow an unknown value to the plain-object shape expected by the validator.
 *
 * 将未知输入收窄为校验器期望的普通对象形态。
 *
 * @param value - Unknown value provided to the validator.
 * 传入校验器的未知值。
 * @returns Whether the value is a non-array object.
 * 该值是否为非数组对象。
 */
function isPlainObject(value: unknown): value is SopDefinition {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
