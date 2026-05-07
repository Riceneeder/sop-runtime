/**
 * @packageDocumentation
 *
 * Public entrypoint for the executor-agent package.
 *
 * `@sop-runtime/executor-agent` 的公共导出入口。
 */

export type { ExecutorHandler } from '@sop-runtime/adapter-core';
export { createAgentExecutor } from './agent-executor.js';
export type {
  AgentExecutorConfig,
  AgentExecutorOptions,
  AgentResult,
  AgentRunOptions,
  AgentRunner,
  AgentTask,
} from './agent-executor.js';
