/** Generates run identifiers when callers do not provide one. 当调用方未提供运行标识时生成 run id。 */
export interface IdGenerator {
  newRunId(): string;
}

/** Best-effort local run id generator for embedded hosts. 面向嵌入式主机的尽力型本地 run id 生成器。 */
export class RandomIdGenerator implements IdGenerator {
  newRunId(): string {
    const randomPart = Math.random().toString(36).slice(2);
    return `run_${Date.now().toString(36)}_${randomPart}`;
  }
}
