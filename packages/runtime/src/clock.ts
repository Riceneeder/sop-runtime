/** Injectable clock used to keep runtime tests and hosts deterministic. */
export interface Clock {
  /** Returns an ISO-8601 timestamp string. */
  now(): string;
}

/** Clock backed by the host process system time. */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
