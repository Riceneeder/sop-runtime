import {RunState} from '@sop-runtime/definition';

export interface StateStore {
  loadRun(runId: string): Promise<RunState | null>;
  saveRun(state: RunState): Promise<void>;
}
