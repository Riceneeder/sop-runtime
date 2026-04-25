/** Generates run identifiers when callers do not provide one. */
export interface IdGenerator {
  newRunId(): string;
}

/** Best-effort local run id generator for embedded hosts. */
export class RandomIdGenerator implements IdGenerator {
  newRunId(): string {
    const randomPart = Math.random().toString(36).slice(2);
    return `run_${Date.now().toString(36)}_${randomPart}`;
  }
}
