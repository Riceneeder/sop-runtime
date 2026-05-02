/**
 * Expression-aware validation for templates embedded in SOP definitions.
 *
 * 针对 SOP 定义中嵌入模板表达式的引用校验器。
 *
 * This file is a thin public facade that delegates to specialized modules.
 */
import {SopDefinition} from '@sop-runtime/definition';
import {Diagnostic} from './diagnostic.js';
import {joinPath} from './path.js';
import {ExpressionValidationContext, ExpressionValidationOptions} from './expression_reference_validator.js';
import {visitTemplateValue} from './expression_template_walk.js';
import {computeReachableStepIds} from './step_reachability.js';

/**
 * Validate every template-bearing field in the SOP definition.
 *
 * 校验 SOP 定义中所有允许出现模板表达式的字段。
 *
 * @param definition - SOP definition to inspect for template expressions.
 * 需要检查模板表达式的 SOP 定义。
 * @returns Expression diagnostics discovered during validation.
 * 表达式校验过程中发现的诊断结果。
 */
export function validateExpressionDefinition(definition: SopDefinition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const knownStepIds = new Set<string>();
  const outputSchemasByStepId = new Map<string, unknown>();

  for (const step of steps) {
    if (typeof step === 'object' && step !== null && typeof step.id === 'string') {
      knownStepIds.add(step.id);
      outputSchemasByStepId.set(step.id, step.output_schema);
    }
  }

  const context: ExpressionValidationContext = {
    'inputSchema': definition.input_schema,
    'defaultsSchema': definition.defaults,
    knownStepIds,
    outputSchemasByStepId,
  };
  const finalOutputOptions: ExpressionValidationOptions = {
    'reachableStepIds': computeReachableStepIds(definition, steps, knownStepIds),
  };

  if (typeof definition.policies?.idempotency_key_template === 'string') {
    visitTemplateValue(definition.policies.idempotency_key_template, 'policies.idempotency_key_template', context, diagnostics);
  }

  if (typeof definition.policies?.concurrency?.key_template === 'string') {
    visitTemplateValue(definition.policies.concurrency.key_template, 'policies.concurrency.key_template', context, diagnostics);
  }

  steps.forEach((step, stepIndex) => {
    if (typeof step !== 'object' || step === null) {
      return;
    }

    if (typeof step.inputs === 'object' && step.inputs !== null && !Array.isArray(step.inputs)) {
      visitTemplateValue(step.inputs, joinPath('steps', stepIndex, 'inputs'), context, diagnostics);
    }

    if (typeof step.executor === 'object' && step.executor !== null) {
      if (typeof step.executor.path === 'string') {
        visitTemplateValue(step.executor.path, joinPath('steps', stepIndex, 'executor', 'path'), context, diagnostics);
      }
    }
  });

  visitTemplateValue(definition.final_output, 'final_output', context, diagnostics, finalOutputOptions);

  return diagnostics;
}
