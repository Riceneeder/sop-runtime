import {JsonObject} from '@sop-runtime/definition';

/** Minimal structured logger boundary for embedding applications. 面向嵌入式应用的最小结构化日志接口边界。 */
export interface RuntimeLogger {
  debug(message: string, details?: JsonObject): void;
  info(message: string, details?: JsonObject): void;
  warn(message: string, details?: JsonObject): void;
  error(message: string, details?: JsonObject): void;
}

/** Logger used when callers do not provide their own logging adapter. 当调用方未提供日志适配器时使用的空日志实现。 */
export class NoopRuntimeLogger implements RuntimeLogger {
  debug(_message: string, _details?: JsonObject): void {}

  info(_message: string, _details?: JsonObject): void {}

  warn(_message: string, _details?: JsonObject): void {}

  error(_message: string, _details?: JsonObject): void {}
}
