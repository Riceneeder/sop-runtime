import {JsonObject} from '@sop-runtime/definition';

/** Minimal structured logger boundary for embedding applications. */
export interface RuntimeLogger {
  debug(message: string, details?: JsonObject): void;
  info(message: string, details?: JsonObject): void;
  warn(message: string, details?: JsonObject): void;
  error(message: string, details?: JsonObject): void;
}

/** Logger used when callers do not provide their own logging adapter. */
export class NoopRuntimeLogger implements RuntimeLogger {
  debug(_message: string, _details?: JsonObject): void {}

  info(_message: string, _details?: JsonObject): void {}

  warn(_message: string, _details?: JsonObject): void {}

  error(_message: string, _details?: JsonObject): void {}
}
