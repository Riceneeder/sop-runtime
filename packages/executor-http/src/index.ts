/**
 * @packageDocumentation
 *
 * Public entrypoint for the executor-http package.
 *
 * `@sop-runtime/executor-http` 的公共导出入口。
 */

export type { ExecutorHandler } from '@sop-runtime/adapter-core';
export { createHttpExecutor } from './http-executor.js';
export type { HttpExecutorOptions } from './http-executor.js';
