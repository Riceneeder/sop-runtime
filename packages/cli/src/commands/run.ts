import {JsonObject, SopDefinition} from '@sop-runtime/definition';
import {validateDefinition} from '@sop-runtime/validator';
import {InMemoryStateStore, RuntimeHost} from '@sop-runtime/runtime';
import {CliOptions, getInputPath, print, readJson} from '../cli.js';

export async function runRun(definitionPath: string | undefined, args: string[], opts: CliOptions): Promise<void> {
  const inputPath = getInputPath(args);
  const definition = readJson<SopDefinition>(definitionPath);
  const input = readJson<JsonObject>(inputPath);

  const v = validateDefinition(definition);
  if (!v.ok) {
    print(v, opts);
    process.exit(1);
  }

  const host = new RuntimeHost({store: new InMemoryStateStore()});

  host.registerExecutor('tool', 'echo', (ctx) => ({
    run_id: ctx.packet.run_id,
    step_id: ctx.packet.step_id,
    attempt: ctx.packet.attempt,
    status: 'success' as const,
    output: ctx.packet.inputs,
  }));

  const started = await host.startRun({definition, input, runId: 'cli-run'});
  const result = await host.runUntilComplete({definition, runId: started.state.run_id});

  print({ok: true, state: result.state, final_output: result.final_output ?? null}, opts);
  process.exit(0);
}
