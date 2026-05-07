import { describe, expect, test } from 'bun:test';
import { createShellExecutor } from '../src/index.js';
import { ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { StepResult, SopDefinition, RunState } from '@sop-runtime/definition';

function makeInput(configOverrides?: Record<string, unknown>): ExecutorHandlerInput {
  const definition: SopDefinition = {
    sop_id: 'test-sop',
    name: 'Test SOP',
    version: '1.0.0',
    entry_step: 's1',
    input_schema: { type: 'object' },
    policies: {
      cooldown_secs: 0,
      max_run_secs: 300,
      idempotency_key_template: '',
      concurrency: { mode: 'allow_parallel', key_template: '' },
    },
    steps: [],
    final_output: {},
  };
  const state: RunState = {
    run_id: 'test-run',
    sop_id: 'test-sop',
    sop_version: '1.0.0',
    status: 'running',
    phase: 'ready',
    run_input: {},
    entry_step_id: 's1',
    current_step_id: null,
    current_attempt: null,
    steps: {},
    accepted_results: {},
    history: [],
  };
  return {
    packet: {
      run_id: 'test-run',
      step_id: 'test-step',
      attempt: 1,
      inputs: {},
      executor: {
        kind: 'shell',
        name: 'local_command',
        timeout_secs: 10,
        allow_network: false,
        env: {},
        resource_limits: { max_output_bytes: 1_048_576, max_artifacts: 0 },
        config: { command: 'echo', args: ['hello'], ...configOverrides },
      },
      output_schema: undefined,
    },
    definition,
    state,
    config: {},
  };
}

const defaultExecutor = createShellExecutor({
  workspaceRoot: '/tmp',
  allowedCommands: {
    echo: '/bin/echo',
    true: '/usr/bin/true',
    false: '/usr/bin/false',
  },
});

describe('createShellExecutor', () => {
  describe('validation errors', () => {
    test('rejects missing command', async () => {
      const input = makeInput();
      delete input.packet.executor.config!.command;
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });

    test('rejects non-string args', async () => {
      const input = makeInput();
      input.packet.executor.config!.args = ['hello', 42];
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });

    test('rejects NUL in command', async () => {
      const input = makeInput({ command: 'echo\0' });
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });

    test('rejects NUL in args', async () => {
      const input = makeInput({ args: ['hello\0world'] });
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });

    test('rejects NUL in cwd', async () => {
      const input = makeInput({ cwd: '/tmp\0' });
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });

    test('rejects command not in allowedCommands', async () => {
      const input = makeInput({ command: 'nonexistent' });
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_command_not_allowed');
    });

    test('rejects executable not found', async () => {
      const executor = createShellExecutor({
        workspaceRoot: '/tmp',
        allowedCommands: { custom: '/nonexistent/path/to/tool' },
      });
      const input = makeInput({ command: 'custom', args: [] });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_executable_not_found');
    });
  });

  describe('successful execution', () => {
    test('executes command and returns success with JSON stdout', async () => {
      const input = makeInput({ args: ['{"hello":"world"}'] });
      const result = await defaultExecutor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ hello: 'world' });
    });

    test('executes command with non-JSON stdout returns {text}', async () => {
      const input = makeInput({ args: ['plain text'] });
      const result = await defaultExecutor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ text: 'plain text\n' });
    });

    test('executes command with empty stdout returns {}', async () => {
      const executor = createShellExecutor({
        workspaceRoot: '/tmp',
        allowedCommands: { true: '/usr/bin/true' },
      });
      const input = makeInput({ command: 'true', args: [] });
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({});
    });
  });

  describe('error handling', () => {
    test('non-zero exit returns tool_error', async () => {
      const executor = createShellExecutor({
        workspaceRoot: '/tmp',
        allowedCommands: { false: '/usr/bin/false' },
      });
      const input = makeInput({ command: 'false', args: [] });
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_exit_nonzero');
      expect(result.error?.details?.exit_code).toBe(1);
    });

    test('timeout kills subprocess', async () => {
      const executor = createShellExecutor({
        workspaceRoot: '/tmp',
        allowedCommands: { sleep: '/bin/sleep' },
      });
      const input = makeInput({ command: 'sleep', args: ['10'] });
      input.packet.executor.timeout_secs = 0.2;

      const start = Date.now();
      const result = await executor.handler(input) as StepResult;
      const elapsed = Date.now() - start;

      expect(result.status).toBe('timeout');
      expect(result.error?.code).toBe('shell_timeout');
      expect(elapsed).toBeLessThan(5000);
    });

    test('stdout too large returns error', async () => {
      const executor = createShellExecutor({
        workspaceRoot: '/tmp',
        allowedCommands: { echo_long: '/bin/echo' },
        maxStdoutBytes: 10,
      });
      // echo "1234567890" produces "1234567890\n" = 11 bytes, exceeding cap of 10
      const input = makeInput({ command: 'echo_long', args: ['1234567890'] });
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_stdout_too_large');
    });

    test('cwd escapes workspaceRoot returns error', async () => {
      const input = makeInput({ cwd: '/etc' });
      const result = await defaultExecutor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('shell_invalid_config');
    });
  });

  describe('side-effect safety', () => {
    test('input is not mutated', async () => {
      const input = makeInput();
      const inputJson = JSON.stringify(input);
      await defaultExecutor.handler(input);
      expect(JSON.stringify(input)).toBe(inputJson);
    });
  });
});
