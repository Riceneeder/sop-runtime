import { appendFile } from 'node:fs/promises';
import { EventSink, RuntimeEvent } from './event_sink.js';

export class JsonlEventSink implements EventSink {
  private queue: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
  }

  emit(event: RuntimeEvent): Promise<void> {
    let line: string;
    try {
      line = JSON.stringify(event) + '\n';
    } catch (err) {
      return Promise.reject(
        new Error(`Failed to serialize event: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    this.queue = this.queue.then(() => appendFile(this.filePath, line, 'utf-8'));
    return this.queue;
  }
}
