import {RunState} from '@sop-exec/definition';

export interface StateStore {
  loadRun(runId: string): Promise<RunState | null>;
  saveRun(state: RunState): Promise<void>;
}
