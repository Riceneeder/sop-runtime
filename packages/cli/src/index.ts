#!/usr/bin/env bun
import {RuntimeHost, InMemoryStateStore} from '@sop-runtime/runtime';
import {buildStepPacket, createRun} from '@sop-runtime/core';
import {validateDefinition} from '@sop-runtime/validator';
import {JsonObject, SopDefinition} from '@sop-runtime/definition';
import {readFileSync} from 'node:fs';

const args = process.argv.slice(2);
const pretty = args.includes('--pretty');
const command = args[0];
if (command === '--help' || command === undefined) { console.log('sop <validate|trace|run> <definition.json> [--input <input.json>] [--pretty]'); process.exit(0); }
if (command === '--version') { console.log('0.1.0-alpha.0'); process.exit(0); }

const print = (v: unknown) => console.log(JSON.stringify(v, null, pretty ? 2 : 0));
try {
  if (command === 'validate') {
    const definition = readJson<SopDefinition>(args[1]);
    const result = validateDefinition(definition);
    print(result);
    process.exit(result.ok ? 0 : 1);
  }
  if (command === 'trace') {
    const inputPath = getInputPath(args);
    const definition = readJson<SopDefinition>(args[1]);
    const input = readJson<JsonObject>(inputPath);
    const v = validateDefinition(definition); if (!v.ok) { print(v); process.exit(1); }
    const state = createRun({definition, input, runId: 'trace-run', now: new Date().toISOString()});
    const packet = buildStepPacket({definition, state});
    print({ok:true, run_id: state.run_id, sop_id: state.sop_id, version: state.sop_version, phase: state.phase, current_step_id: state.current_step_id, packet}); process.exit(0);
  }
  if (command === 'run') {
    const inputPath = getInputPath(args);
    const definition = readJson<SopDefinition>(args[1]);
    const input = readJson<JsonObject>(inputPath);
    const v = validateDefinition(definition); if (!v.ok) { print(v); process.exit(1); }
    const host = new RuntimeHost({store: new InMemoryStateStore()});
    host.registerExecutor('tool', 'echo', (ctx) => ({run_id: ctx.packet.run_id, step_id: ctx.packet.step_id, attempt: ctx.packet.attempt, status:'success', output: ctx.packet.inputs}));
    const started = await host.startRun({definition, input, runId: 'cli-run'});
    const result = await host.runUntilComplete({definition, runId: started.state.run_id});
    print({ok:true, state: result.state, final_output: result.final_output ?? null}); process.exit(0);
  }
  throw new Error(`unknown command: ${command}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  print({ok:false, error:{code:'cli_error', message}});
  process.exit(1);
}

function readJson<T>(path: string | undefined): T { if (!path) { throw new Error('missing json path'); } return JSON.parse(readFileSync(path, 'utf8')) as T; }
function getInputPath(argsList: string[]): string { const idx = argsList.indexOf('--input'); if (idx < 0) { throw new Error('missing --input'); } const value = argsList[idx + 1]; if (value === undefined) { throw new Error('missing --input'); } return value; }
