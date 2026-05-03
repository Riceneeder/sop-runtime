import { describe, expect, test } from 'bun:test';
import {
  buildDefinition,
  buildHost,
  FixedClock,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('executor handler input isolation', () => {
  test('handler cannot bypass max_output_bytes by mutating resource_limits', async () => {
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_output_bytes = 5;
    const { host } = buildHost({
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    host.registerExecutor('tool', 'default_tool', (input) => {
      // Handler tries to bypass the limit by mutating the resource_limits
      input.packet.executor.resource_limits.max_output_bytes = 1_000_000;
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'data': 'x'.repeat(200) },
      };
    });

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(nextState.phase).toBe('awaiting_decision');
    const accepted = nextState.accepted_results.step_a;
    expect(accepted?.status).toBe('sandbox_error');
    expect(accepted?.error?.code).toBe('max_output_bytes_exceeded');
  });

  test('handler cannot bypass max_artifacts by mutating resource_limits', async () => {
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_artifacts = 1;
    const { host } = buildHost({
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    host.registerExecutor('tool', 'default_tool', (input) => {
      // Handler tries to bypass the limit by mutating the resource_limits
      input.packet.executor.resource_limits.max_artifacts = 1_000_000;
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'ok' },
        'artifacts': {
          'a': '/tmp/a',
          'b': '/tmp/b',
          'c': '/tmp/c',
        },
      };
    });

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(nextState.phase).toBe('awaiting_decision');
    const accepted = nextState.accepted_results.step_a;
    expect(accepted?.status).toBe('sandbox_error');
    expect(accepted?.error?.code).toBe('max_artifacts_exceeded');
  });

  test('handler mutating cloned executor does not affect the original packet', async () => {
    const definition = buildDefinition();
    definition.steps[0]!.executor.resource_limits.max_artifacts = 10;
    const { host } = buildHost({
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
    });

    let capturedOriginalPacket: { resource_limits: { max_artifacts: number } } | undefined;

    host.registerExecutor('tool', 'default_tool', (input) => {
      // Handler mutates the resource_limits on what it receives
      input.packet.executor.resource_limits.max_artifacts = 999;
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'ok' },
        'artifacts': { 'a': '/tmp/a' },
      };
    });

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });

    // Run a second executor after the first to verify the original definition is intact
    const nextState = await host.runReadyStep({ definition, 'runId': started.state.run_id });

    expect(nextState.phase).toBe('awaiting_decision');
    const accepted = nextState.accepted_results.step_a;
    expect(accepted?.status).toBe('success');

    // Verify the definition — on the executor passed to the handler — still shows 10
    // (handler should receive a clone, leaving original and any future dispatch intact)
    capturedOriginalPacket = { 'resource_limits': { ...definition.steps[0]!.executor.resource_limits } };
    expect(capturedOriginalPacket.resource_limits.max_artifacts).toBe(10);
  });
});
