import {readFileSync} from 'node:fs';
import {runValidate} from './commands/validate.js';
import {runTrace} from './commands/trace.js';
import {runRun} from './commands/run.js';

export interface CliOptions {
  pretty: boolean;
}

export function print(v: unknown, opts?: CliOptions): void {
  console.log(JSON.stringify(v, null, opts?.pretty ? 2 : 0));
}

export function formatCliError(error: unknown): {code: string; message: string} {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as {code: unknown}).code;
    if (typeof code === 'string') {
      return {code, message: error instanceof Error ? error.message : String(error)};
    }
  }
  return {code: 'cli_error', message: error instanceof Error ? error.message : String(error)};
}

export function readJson<T>(path: string | undefined): T {
  if (!path) {
    throw new Error('missing json path');
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function getInputPath(argsList: string[]): string {
  const idx = argsList.indexOf('--input');
  if (idx < 0) {
    throw new Error('missing --input');
  }
  const value = argsList[idx + 1];
  if (value === undefined) {
    throw new Error('missing --input value');
  }
  return value;
}

export async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const clean = raw.filter((a) => a !== '--pretty');
  const opts: CliOptions = {pretty: raw.length !== clean.length};

  const command = clean[0];

  if (command === '--help' || command === undefined) {
    console.log('sop <validate|trace|run> <definition.json> [--input <input.json>] [--pretty]');
    process.exit(0);
  }

  if (command === '--version') {
    console.log('0.2.4-alpha.0');
    process.exit(0);
  }

  try {
    if (command === 'validate') {
      runValidate(clean[1], opts);
      return;
    }
    if (command === 'trace') {
      runTrace(clean[1], clean, opts);
      return;
    }
    if (command === 'run') {
      await runRun(clean[1], clean, opts);
      return;
    }
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    const err = formatCliError(error);
    print({ok: false, error: err}, opts);
    process.exit(1);
  }
}
