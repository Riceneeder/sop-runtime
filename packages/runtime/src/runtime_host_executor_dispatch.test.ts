import { describe, expect, test } from 'bun:test';
import { SopDefinition, StepResult } from '@sop-runtime/definition';
import { RuntimeError } from './index.js';
import {
  buildDefinition,
  buildHost,
  PacketSnapshot,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
  test('throws executor_not_registered when no handler is registered for the executor kind+name', async () => {
    const { host } = buildHost();
    // Deliberately do NOT register any executor
    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': { 'company': 'Acme' },
    });

    let execError: unknown;
    try {
      await host.runReadyStep({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
      });
    } catch (caught) {
      execError = caught;
    }

    expect(execError).toBeInstanceOf(RuntimeError);
    expect((execError as RuntimeError).code).toBe('executor_not_registered');
  });

  test('dispatches to the correct handler based on kind + name', async () => {
    const { host } = buildHost();
    const packetsA: PacketSnapshot[] = [];
    const packetsB: PacketSnapshot[] = [];

    host.registerExecutor('kind_a', 'name_x', (input) => {
      packetsA.push({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'inputs': input.packet.inputs,
        'executor': input.packet.executor,
      });
      return { 'run_id': input.packet.run_id, 'step_id': input.packet.step_id, 'attempt': input.packet.attempt, 'status': 'success', 'output': {} };
    });
    host.registerExecutor('kind_b', 'name_y', (input) => {
      packetsB.push({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'inputs': input.packet.inputs,
        'executor': input.packet.executor,
      });
      return { 'run_id': input.packet.run_id, 'step_id': input.packet.step_id, 'attempt': input.packet.attempt, 'status': 'success', 'output': {} };
    });

    // Build a definition that uses kind_a:name_x
    const stepA = buildDefinition().steps[0]!;
    const definitionA: SopDefinition = {
      ...buildDefinition(),
      'steps': [{
        ...stepA,
        'executor': {
          ...stepA.executor,
          'kind': 'kind_a',
          'name': 'name_x',
        },
      }],
    };
    const startedA = await host.startRun({ 'definition': definitionA, 'input': { 'company': 'A' } });
    await host.runReadyStep({ 'definition': definitionA, 'runId': startedA.state.run_id });

    expect(packetsA).toHaveLength(1);
    expect(packetsB).toHaveLength(0);
  });

  test('handler cannot bypass core state transition — invalid result is rejected', async () => {
    const { host } = buildHost();
    // Register a handler that returns an invalid status
    host.registerExecutor('tool', 'default_tool', (input) => {
      return {
        'run_id': input.packet.run_id,
        'step_id': 'wrong_step',
        'attempt': 999,
        'status': 'success',
        'output': {},
      } as StepResult;
    });

    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': { 'company': 'Acme' },
    });

    let coreError: unknown;
    try {
      await host.runReadyStep({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
      });
    } catch (caught) {
      coreError = caught;
    }

    // The CoreError from applyStepResult should propagate
    expect(coreError).toBeInstanceOf(Error);
    expect((coreError as Error).name).toBe('CoreError');
  });

  describe('dispatchExecutor enforcement', () => {
    test('enforces timeout and returns timeout StepResult', async () => {
      const definition = buildDefinition();
      definition.steps[0]!.executor.timeout_secs = 1;
      const { host } = buildHost();

      host.registerExecutor('tool', 'default_tool', () => {
        return new Promise<StepResult>(() => { /* never settles */ });
      });

      const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
      const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

      expect(nextState.phase).toBe('awaiting_decision');
      const accepted = nextState.accepted_results.step_a;
      expect(accepted?.status).toBe('timeout');
      expect(accepted?.error?.code).toBe('executor_timeout');
    });

    test('enforces max_output_bytes', async () => {
      const definition = buildDefinition();
      definition.steps[0]!.executor.resource_limits.max_output_bytes = 5;
      const { host } = buildHost();

      host.registerExecutor('tool', 'default_tool', (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'data': 'x'.repeat(200) },
      }));

      const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
      const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

      expect(nextState.phase).toBe('awaiting_decision');
      const accepted = nextState.accepted_results.step_a;
      expect(accepted?.status).toBe('sandbox_error');
      expect(accepted?.error?.code).toBe('max_output_bytes_exceeded');
    });

    test('enforces max_artifacts', async () => {
      const definition = buildDefinition();
      definition.steps[0]!.executor.resource_limits.max_artifacts = 1;
      const { host } = buildHost();

      host.registerExecutor('tool', 'default_tool', (input) => ({
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'ok' },
        'artifacts': { 'a': '/tmp/a', 'b': '/tmp/b' },
      }));

      const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
      const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

      expect(nextState.phase).toBe('awaiting_decision');
      const accepted = nextState.accepted_results.step_a;
      expect(accepted?.status).toBe('sandbox_error');
      expect(accepted?.error?.code).toBe('max_artifacts_exceeded');
    });

    test('propagates handler error through timeout wrapper', async () => {
      const { host } = buildHost();

      host.registerExecutor('tool', 'default_tool', () => {
        throw new Error('handler crash');
      });

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });

      let error: unknown;
      try {
        await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('handler crash');
    });
  });
});
