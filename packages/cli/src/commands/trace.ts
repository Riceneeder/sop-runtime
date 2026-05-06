import {JsonObject, SopDefinition} from '@sop-runtime/definition';
import {buildStepPacket, createRun} from '@sop-runtime/core';
import {validateDefinition} from '@sop-runtime/validator';
import {CliOptions, getInputPath, print, readJson} from '../cli.js';

export function runTrace(definitionPath: string | undefined, args: string[], opts: CliOptions): void {
  const inputPath = getInputPath(args);
  const definition = readJson<SopDefinition>(definitionPath);
  const input = readJson<JsonObject>(inputPath);

  const v = validateDefinition(definition);
  if (!v.ok) {
    print(v, opts);
    process.exit(1);
  }

  const state = createRun({definition, input, runId: 'trace-run', now: new Date().toISOString()});
  const packet = buildStepPacket({definition, state});

  print({
    ok: true,
    run_id: state.run_id,
    sop_id: state.sop_id,
    version: state.sop_version,
    phase: state.phase,
    current_step_id: state.current_step_id,
    packet,
  }, opts);
  process.exit(0);
}
