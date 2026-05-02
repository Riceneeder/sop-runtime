/**
 * @packageDocumentation
 *
 * Public entrypoint for the definition package.
 *
 * `@sop-runtime/definition` 的公共导出入口。
 */
export {
  RUN_PHASES,
  RUN_STATUSES,
  STEP_LIFECYCLES,
} from './run_state.js';
export type {
  HistoryEntry,
  RunPhase,
  RunState,
  RunStatus,
  StepLifecycle,
  StepState,
} from './run_state.js';
export {
  ACCEPTED_STEP_RESULT_STATUSES,
  EXECUTOR_RESULT_STATUSES,
} from './execution.js';
export type {
  AcceptedStepResult,
  AcceptedStepResultStatus,
  Decision,
  ExecutorResultStatus,
  FinalOutput,
  StepError,
  StepPacket,
  StepResult,
  StepRun,
} from './execution.js';
export {
  isJsonSafeObject,
  isJsonSafeValue,
  isStrictPlainObject,
  isStringRecord,
} from './json_value.js';
export type {JsonArray, JsonObject, JsonPrimitive, JsonValue} from './json_value.js';
export type {
  AllowedOutcome,
  ExecutorConfig,
  ResourceLimits,
  RetryPolicy,
  RetryableStepResultStatus,
  SopDefinition,
  StepDefinition,
  SupervisionConfig,
  Transition,
} from './sop_definition.js';
export {
  RETRYABLE_STEP_RESULT_STATUSES,
} from './sop_definition.js';
export {
  ExpressionSyntaxError,
  parseExpressionBody,
  parseExpressionTemplate,
} from './expression.js';
export {defineSop} from './builder.js';
export type {
  CoalesceExpression,
  ExpressionLiteral,
  ExpressionNode,
  ExpressionReference,
  ExpressionSegment,
  TemplateSegment,
  TextSegment,
} from './expression.js';

