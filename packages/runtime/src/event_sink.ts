import {JsonObject} from '@sop-runtime/definition';

/** Runtime lifecycle events emitted by RuntimeHost. */
export type RuntimeEventKind =
  | 'run_started'
  | 'run_reused'
  | 'step_packet_built'
  | 'step_result_accepted'
  | 'decision_applied'
  | 'run_terminated';

/** Audit event emitted after host-level orchestration milestones. */
export interface RuntimeEvent {
  kind: RuntimeEventKind;
  run_id: string;
  at: string;
  details?: JsonObject;
}

/** Optional audit/event sink for hosts that need observability. */
export interface EventSink {
  emit(event: RuntimeEvent): Promise<void> | void;
}

/** Event sink used when callers do not need audit emission. */
export class NoopEventSink implements EventSink {
  emit(_event: RuntimeEvent): void {}
}
