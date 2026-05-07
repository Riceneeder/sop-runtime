/**
 * @packageDocumentation
 *
 * Public entrypoint for the executor-file package.
 *
 * `@sop-runtime/executor-file` 的公共导出入口。
 */

export type { ExecutorHandler } from '@sop-runtime/adapter-core';
export { createFileExecutor } from './file-executor.js';
export type { FileExecutorOptions } from './file-executor.js';
