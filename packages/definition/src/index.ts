/**
 * @packageDocumentation
 *
 * Public entrypoint for the definition package.
 *
 * `@sop-exec/definition` 的公共导出入口。
 */
export {
  RUN_PHASES,
  RUN_STATUSES,
  STEP_LIFECYCLES,
} from './run_state';
export type {
  HistoryEntry,
  RunPhase,
  RunState,
  RunStatus,
  StepLifecycle,
  StepState,
} from './run_state';
export {
  ACCEPTED_STEP_RESULT_STATUSES,
  EXECUTOR_RESULT_STATUSES,
} from './execution';
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
} from './execution';
export type {JsonArray, JsonObject, JsonPrimitive, JsonValue} from './json_value';
export type {
  AllowedOutcome,
  ExecutorConfig,
  ResourceLimits,
  RetryPolicy,
  RetryableStepResultStatus,
  SandboxModelExecutorConfig,
  SandboxScriptExecutorConfig,
  SandboxToolExecutorConfig,
  SopDefinition,
  StepDefinition,
  SupervisionConfig,
  Transition,
} from './sop_definition';
export {
  RETRYABLE_STEP_RESULT_STATUSES,
} from './sop_definition';
export {
  ExpressionSyntaxError,
  parseExpressionBody,
  parseExpressionTemplate,
} from './expression';
export type {
  CoalesceExpression,
  ExpressionLiteral,
  ExpressionNode,
  ExpressionReference,
  ExpressionSegment,
  TemplateSegment,
  TextSegment,
} from './expression';
