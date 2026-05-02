/**
 * Structural schema validation for SOP definitions.
 *
 * 针对 SOP 定义做结构层面的模式校验。
 *
 * This file is a thin public facade that delegates to specialized modules.
 */
import {SopDefinition} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {validateFinalOutput, validatePolicies, validateRoot, validateSteps} from './schema_sections.js';

/**
 * Validate the object shape, required fields, and primitive constraints.
 *
 * 校验对象结构、必填字段以及基础类型约束。
 *
 * @param definition - SOP definition to validate structurally.
 * 需要进行结构校验的 SOP 定义。
 * @returns Schema diagnostics collected from the definition.
 * 从该定义中收集到的结构诊断信息。
 */
export function validateSchemaDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  validateRoot(definition, diagnostics);
  validatePolicies(definition.policies, diagnostics);
  validateSteps(definition.steps, diagnostics);
  validateFinalOutput(definition.final_output, diagnostics);

  return diagnostics;
}
