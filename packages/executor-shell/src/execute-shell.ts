import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSuccessResult,
  buildToolErrorResult,
  ExecutorAdapter,
  ExecutorHandlerInput,
} from '@sop-runtime/adapter-core';
import { JsonObject, StepPacket, StepResult } from '@sop-runtime/definition';

export interface ShellExecutorOptions {
  workspaceRoot: string;
  allowedCommands: Record<string, string>;
  baseEnv?: Record<string, string>;
  maxStderrBytes?: number;
  maxStdoutBytes?: number;
}

export function createShellExecutor(options: ShellExecutorOptions): ExecutorAdapter {
  for (const [_name, path] of Object.entries(options.allowedCommands)) {
    if (!path.startsWith('/')) {
      throw new Error(`allowedCommands entry "${_name}" must be an absolute path, got: "${path}"`);
    }
  }
  return {
    kind: 'shell',
    name: 'local_command',
    description: 'Executes a local shell command with resource enforcement',
    handler: (input) => executeShell(input, options),
  };
}

const DEFAULT_MAX_STDOUT_BYTES = 1_048_576;
const DEFAULT_MAX_STDERR_BYTES = 65_536;
const STDOUT_ERROR_TRUNCATE_CHARS = 1_000;

interface StreamReadResult {
  data: string;
  capExceeded: boolean;
}

interface ValidatedConfig {
  command: string;
  args: string[];
  resolvedCwd: string | undefined;
  execPath: string;
  env: Record<string, string>;
}

async function readWithCap(
  stream: ReadableStream<Uint8Array>,
  capBytes: number,
): Promise<StreamReadResult> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capExceeded = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!capExceeded) {
        const remaining = capBytes - total;
        if (remaining <= 0) {
          capExceeded = true;
        } else if (value.length > remaining) {
          chunks.push(value.subarray(0, remaining));
          total = capBytes;
          capExceeded = true;
        } else {
          chunks.push(value);
          total += value.length;
        }
      }
    }
  } catch {
    // stream error -- return what we have
  }
  const text = chunks.length > 0
    ? new TextDecoder().decode(concatArrays(chunks))
    : '';
  return { data: text, capExceeded };
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function parseOutput(stdout: string): JsonObject {
  if (stdout.length === 0) return {};
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { text: stdout };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve_) => setTimeout(resolve_, ms));
}

function resolveCwdSafe(
  rawCwd: string,
  workspaceRoot: string,
  packet: StepPacket,
): string | StepResult {
  const resolvedCwd = resolve(workspaceRoot, rawCwd);
  const root = resolve(workspaceRoot);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (resolvedCwd !== root && !resolvedCwd.startsWith(prefix)) {
    return buildToolErrorResult(
      packet, 'shell_invalid_config', 'cwd escapes workspace root',
      { cwd: rawCwd, resolvedCwd, workspaceRoot },
    );
  }
  return resolvedCwd;
}

function validateStepConfig(
  input: ExecutorHandlerInput,
  options: ShellExecutorOptions,
): ValidatedConfig | StepResult {
  const packet = input.packet as StepPacket;
  const config = packet.executor.config ?? {};
  const rawCommand = config.command;
  if (typeof rawCommand !== 'string' || rawCommand.includes('\0') || rawCommand.length === 0) {
    return buildToolErrorResult(packet, 'shell_invalid_config', 'invalid command');
  }
  const rawArgs = config.args;
  if (!Array.isArray(rawArgs)) {
    return buildToolErrorResult(packet, 'shell_invalid_config', 'args must be an array');
  }
  for (const arg of rawArgs) {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      return buildToolErrorResult(packet, 'shell_invalid_config', 'invalid arg');
    }
  }
  const rawCwd = config.cwd;
  if (rawCwd !== undefined && typeof rawCwd !== 'string') {
    return buildToolErrorResult(packet, 'shell_invalid_config', 'cwd must be a string');
  }
  if (typeof rawCwd === 'string') {
    if (rawCwd.includes('\0')) return buildToolErrorResult(packet, 'shell_invalid_config', 'invalid cwd');
  }
  let resolvedCwd: string | undefined;
  if (typeof rawCwd === 'string') {
    const r = resolveCwdSafe(rawCwd, options.workspaceRoot, packet);
    if (typeof r !== 'string') return r;
    resolvedCwd = r;
  }
  const execPath = options.allowedCommands[rawCommand];
  if (!execPath) {
    return buildToolErrorResult(
      packet, 'shell_command_not_allowed', `command '${rawCommand}' is not in allowedCommands`,
    );
  }
  if (!existsSync(execPath)) {
    return buildToolErrorResult(
      packet, 'shell_executable_not_found', `executable not found: ${execPath}`,
    );
  }
  const env: Record<string, string> = { ...(options.baseEnv ?? {}) };
  for (const [k, v] of Object.entries(packet.executor.env)) {
    if (k.includes('\0') || v.includes('\0')) {
      return buildToolErrorResult(packet, 'shell_invalid_config', 'env key or value contains NUL');
    }
    env[k] = v;
  }
  return { command: rawCommand, args: rawArgs as string[], resolvedCwd, execPath, env };
}

function trySpawn(
  execPath: string, args: string[], env: Record<string, string>,
  cwd: string | undefined, packet: StepPacket,
): StepResult | ReturnType<typeof Bun.spawn> {
  try {
    return Bun.spawn([execPath, ...args], {
      env, cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
  } catch (err) {
    return buildToolErrorResult(
      packet, 'shell_spawn_failed', `Failed to spawn process: ${String(err)}`,
    );
  }
}

function tryWriteStdin(proc: ReturnType<typeof Bun.spawn>, bytes: Uint8Array): void {
  if (proc.stdin && typeof proc.stdin !== 'number') {
    try {
      proc.stdin.write(bytes);
      proc.stdin.end();
    } catch {
      // process may have closed stdin early -- safe to ignore
    }
  }
}

async function raceExit(
  proc: ReturnType<typeof Bun.spawn>, timeoutMs: number,
): Promise<number | 'timeout'> {
  const result = await Promise.race([
    proc.exited.then((code) => ({ kind: 'exited' as const, code })),
    sleep(timeoutMs).then(() => ({ kind: 'timeout' as const })),
  ]);
  if (result.kind === 'timeout') return 'timeout';
  return result.code;
}

function buildNonZeroError(
  packet: StepPacket, exitCode: number,
  stdoutResult: StreamReadResult, stderrResult: StreamReadResult,
): StepResult {
  const truncatedStdout = stdoutResult.data.slice(0, STDOUT_ERROR_TRUNCATE_CHARS);
  const details: JsonObject = {
    exit_code: exitCode, stdout: truncatedStdout, stderr: stderrResult.data,
  };
  if (stderrResult.capExceeded) {
    details.stderr_truncated = true;
  }
  return buildToolErrorResult(
    packet, 'shell_exit_nonzero', `Process exited with code ${exitCode}`, details,
  );
}

async function executeShell(
  input: ExecutorHandlerInput,
  options: ShellExecutorOptions,
): Promise<StepResult> {
  const validated = validateStepConfig(input, options);
  if ('status' in validated) return validated;
  const { args, execPath, env, resolvedCwd } = validated;
  const packet = input.packet as StepPacket;
  const stdinBytes = new TextEncoder().encode(JSON.stringify({
    run_id: packet.run_id, step_id: packet.step_id, attempt: packet.attempt,
    inputs: packet.inputs, config: packet.executor.config,
  }));
  const stdoutCap = Math.min(
    options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES,
    packet.executor.resource_limits.max_output_bytes,
  );
  const stderrCap = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  const timeoutMs = Math.max(0, Math.round(packet.executor.timeout_secs * 1000));
  const proc = trySpawn(execPath, args, env, resolvedCwd, packet);
  if ('status' in proc) return proc;
  tryWriteStdin(proc, stdinBytes);
  if (!proc.stdout || typeof proc.stdout === 'number' || !proc.stderr || typeof proc.stderr === 'number') {
    return buildToolErrorResult(packet, 'shell_spawn_failed', 'stdio pipe not available');
  }
  const stdoutRead = readWithCap(proc.stdout, stdoutCap);
  const stderrRead = readWithCap(proc.stderr, stderrCap);
  const exitResult = await raceExit(proc, timeoutMs);
  if (exitResult === 'timeout') {
    proc.kill(15); // SIGTERM
    await Promise.race([
      proc.exited.catch(() => {}),
      sleep(5000).then(() => {
        proc.kill(9); // SIGKILL fallback
        return proc.exited.catch(() => {});
      }),
    ]);
    await Promise.allSettled([stdoutRead, stderrRead]);
    return {
      run_id: packet.run_id,
      step_id: packet.step_id,
      attempt: packet.attempt,
      status: 'timeout' as const,
      error: {
        code: 'shell_timeout',
        message: 'Step execution timed out.',
        details: { timeout_secs: packet.executor.timeout_secs },
      },
    };
  }
  const stdoutResult = await stdoutRead;
  const stderrResult = await stderrRead;
  if (exitResult !== 0) {
    return buildNonZeroError(packet, exitResult, stdoutResult, stderrResult);
  }
  if (stdoutResult.capExceeded) {
    return buildToolErrorResult(
      packet, 'shell_stdout_too_large',
      'Standard output exceeds maximum allowed size.', { max_bytes: stdoutCap },
    );
  }
  const output = parseOutput(stdoutResult.data);
  return buildSuccessResult(packet, output);
}
