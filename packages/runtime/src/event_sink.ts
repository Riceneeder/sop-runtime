import {JsonObject} from '@sop-runtime/definition';

/** Runtime lifecycle events emitted by RuntimeHost. 由 RuntimeHost 发出的运行时生命周期事件。 */
export type RuntimeEventKind =
  | 'run_started'
  | 'run_reused'
  | 'step_packet_built'
  | 'step_result_accepted'
  | 'decision_applied'
  | 'run_paused'
  | 'run_resumed'
  | 'run_terminated';

/** Audit event emitted after host-level orchestration milestones. 主机级编排里程碑之后发出的审计事件。 */
export interface RuntimeEvent {
  kind: RuntimeEventKind;
  run_id: string;
  at: string;
  details?: JsonObject;
}

/** Optional audit/event sink for hosts that need observability. 面向需要可观测性的主机的可选审计/事件下沉接口。 */
export interface EventSink {
  emit(event: RuntimeEvent): Promise<void> | void;
}

/** Event sink used when callers do not need audit emission. 当调用方不需要审计事件时使用的空实现。 */
export class NoopEventSink implements EventSink {
  emit(_event: RuntimeEvent): void {}
}
