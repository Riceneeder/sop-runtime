/**
 * Final-output reachability analysis for expression validation.
 *
 * 表达式校验中用于分析最终输出可达性的工具模块。
 */
import {SopDefinition} from '@sop-runtime/definition';

/**
 * Compute all steps reachable from the declared entry step via valid transitions.
 *
 * 从入口步骤出发，计算通过合法转移能够到达的全部步骤。
 *
 * @param definition - Root SOP definition.
 * @param steps - Raw step list from the definition.
 * @param knownStepIds - Set of known step identifiers.
 * @returns Reachable step ids, or `undefined` when reachability cannot be computed safely.
 */
export function computeReachableStepIds(
  definition: SopDefinition,
  steps: unknown[],
  knownStepIds: Set<string>,
): Set<string> | undefined {
  if (typeof definition.entry_step !== 'string' || !knownStepIds.has(definition.entry_step)) {
    return undefined;
  }

  const stepById = new Map<string, Record<string, unknown>>();
  for (const step of steps) {
    if (isPlainObject(step) && typeof step.id === 'string' && !stepById.has(step.id)) {
      stepById.set(step.id, step);
    }
  }

  const reachableStepIds = new Set<string>();
  const queue = [definition.entry_step];

  // BFS traversal: follow valid next_step transitions to discover reachable steps
  while (queue.length > 0) {
    const stepId = queue.shift();
    if (stepId === undefined || reachableStepIds.has(stepId)) {
      continue;
    }

    reachableStepIds.add(stepId);
    const step = stepById.get(stepId);
    if (step === undefined || !isPlainObject(step.transitions)) {
      continue;
    }

    const allowedOutcomeIds = collectAllowedOutcomeIds(step);
    for (const [transitionKey, transition] of Object.entries(step.transitions)) {
      if (allowedOutcomeIds !== undefined && !allowedOutcomeIds.has(transitionKey)) {
        continue;
      }

      const nextStepId = getValidTransitionNextStepId(transition);
      if (nextStepId !== undefined && knownStepIds.has(nextStepId) && !reachableStepIds.has(nextStepId)) {
        queue.push(nextStepId);
      }
    }
  }

  return reachableStepIds;
}

/**
 * Collect the outcome ids that supervision explicitly allows for a step.
 *
 * 收集某个步骤监督配置里显式允许的 outcome 标识。
 */
export function collectAllowedOutcomeIds(step: Record<string, unknown>): Set<string> | undefined {
  if (!isPlainObject(step.supervision) || !Array.isArray(step.supervision.allowed_outcomes)) {
    return undefined;
  }

  const outcomeIds = new Set<string>();
  for (const outcome of step.supervision.allowed_outcomes) {
    if (isPlainObject(outcome) && typeof outcome.id === 'string') {
      outcomeIds.add(outcome.id);
    }
  }

  return outcomeIds;
}

/**
 * Read the next-step target from a transition only when the transition is structurally valid.
 *
 * 仅当转移结构合法时，读取其中的下一步骤目标。
 */
export function getValidTransitionNextStepId(transition: unknown): string | undefined {
  if (!isPlainObject(transition)) {
    return undefined;
  }

  const hasNextStep = Object.hasOwn(transition, 'next_step');
  const hasTerminate = Object.hasOwn(transition, 'terminate');
  if (!hasNextStep || hasTerminate || typeof transition.next_step !== 'string') {
    return undefined;
  }

  return transition.next_step;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
