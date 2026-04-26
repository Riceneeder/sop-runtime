/** Injectable clock used to keep runtime tests and hosts deterministic. 可注入时钟，用于保持运行时测试与主机行为可预测。 */
export interface Clock {
  /** Returns an ISO-8601 timestamp string. 返回 ISO-8601 时间戳字符串。 */
  now(): string;
}

/** Clock backed by the host process system time. 基于宿主进程系统时间的时钟实现。 */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
