import { describe, expect, test } from 'bun:test';
import { createAgentExecutor } from '../src/index.js';
import {
  AgentRunner,
  AgentTask,
} from '../src/index.js';
import { ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { StepResult, SopDefinition, RunState, JsonObject } from '@sop-runtime/definition';

function createMockRunner(
  output: Record<string, unknown>,
  error?: Error,
): AgentRunner {
  return {
    async run(_task: AgentTask) {
      if (error) throw error;
      return {
        output,
        artifacts: { key: 'val' },
        metrics: { dur_ms: 10 },
      };
    },
  };
}

function makeInput(agentConfig?: JsonObject): ExecutorHandlerInput {
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
      inputs: { foo: 'bar' },
      executor: {
        kind: 'agent',
        name: 'local_agent',
        timeout_secs: 60,
        allow_network: false,
        env: {},
        resource_limits: {
          max_output_bytes: 1_048_576,
          max_artifacts: 10,
        },
        config: {},
      },
      output_schema: { type: 'object' },
    },
    definition,
    state,
    config: { ...agentConfig },
  };
}

describe('createAgentExecutor', () => {
  describe('runner selection', () => {
    test('rejects when runners is empty', async () => {
      const executor = createAgentExecutor({ runners: {} });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('agent_invalid_config');
    });

    test('uses agent_key to select runner', async () => {
      const runnerA = createMockRunner({ result: 'fromA' });
      const runnerB = createMockRunner({ result: 'fromB' });
      const executor = createAgentExecutor({
        runners: { a: runnerA, b: runnerB },
      });
      const input = makeInput({ agent_key: 'b' });
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ result: 'fromB' });
    });

    test('uses defaultRunner when agent_key not set', async () => {
      const runnerA = createMockRunner({ result: 'fromA' });
      const runnerB = createMockRunner({ result: 'fromB' });
      const executor = createAgentExecutor({
        runners: { a: runnerA, b: runnerB },
        defaultRunner: 'a',
      });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ result: 'fromA' });
    });

    test('uses only runner when no agent_key and no defaultRunner', async () => {
      const runner = createMockRunner({ result: 'fromSolo' });
      const executor = createAgentExecutor({ runners: { solo: runner } });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ result: 'fromSolo' });
    });

    test('returns error when agent_key points to non-existent runner', async () => {
      const runner = createMockRunner({ result: 'test' });
      const executor = createAgentExecutor({ runners: { a: runner } });
      const input = makeInput({ agent_key: 'nonexistent' });
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('agent_runner_not_found');
    });

    test('returns error when cannot determine runner', async () => {
      const runnerA = createMockRunner({ result: 'fromA' });
      const runnerB = createMockRunner({ result: 'fromB' });
      const executor = createAgentExecutor({
        runners: { a: runnerA, b: runnerB },
      });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('agent_runner_not_selected');
    });
  });

  describe('execution', () => {
    test('returns success with runner output', async () => {
      const runner = createMockRunner({ result: 'test' });
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ result: 'test' });
      expect(result.artifacts).toEqual({ key: 'val' });
      expect(result.metrics).toEqual({ dur_ms: 10 });
    });

    test('passes correct task fields', async () => {
      let capturedTask: AgentTask | undefined;
      const runner: AgentRunner = {
        async run(task: AgentTask) {
          capturedTask = task;
          return { output: {} };
        },
      };
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput();
      await executor.handler(input);
      expect(capturedTask?.run_id).toBe('test-run');
      expect(capturedTask?.sop_id).toBe('test-sop');
      expect(capturedTask?.sop_version).toBe('1.0.0');
      expect(capturedTask?.step_id).toBe('test-step');
      expect(capturedTask?.attempt).toBe(1);
      expect(capturedTask?.inputs).toEqual({ foo: 'bar' });
      expect(capturedTask?.allow_network).toBe(false);
      expect(capturedTask?.config).toEqual({});
    });

    test('passes config including agent_key and system_prompt', async () => {
      let capturedTask: AgentTask | undefined;
      const runner: AgentRunner = {
        async run(task: AgentTask) {
          capturedTask = task;
          return { output: {} };
        },
      };
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput({
        agent_key: 'r',
        system_prompt: 'You are a helpful assistant.',
        extra_field: 42,
      });
      await executor.handler(input);
      expect(capturedTask?.config).toEqual({
        agent_key: 'r',
        system_prompt: 'You are a helpful assistant.',
        extra_field: 42,
      });
    });
  });

  describe('error handling', () => {
    test('runner error returns tool_error', async () => {
      const runner = createMockRunner({}, new Error('something broke'));
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('agent_runner_error');
    });

    test('non-object output returns tool_error', async () => {
      const runner: AgentRunner = {
        async run(_task: AgentTask) {
          return { output: null as unknown as Record<string, unknown> };
        },
      };
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput();
      const result = await executor.handler(input) as StepResult;
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('agent_invalid_output');
    });
  });

  describe('side-effect safety', () => {
    test('input is not mutated', async () => {
      const runner = createMockRunner({ result: 'test' });
      const executor = createAgentExecutor({ runners: { r: runner } });
      const input = makeInput();
      const inputJson = JSON.stringify(input);
      await executor.handler(input);
      expect(JSON.stringify(input)).toBe(inputJson);
    });
  });
});
