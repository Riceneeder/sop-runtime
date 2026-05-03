import { describe, expect, test } from 'bun:test';
import { RuntimeError } from '../src/index.js';
import {
  buildDefinition,
  buildHost,
  registerDefaultExecutor,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
  test('starts a run, executes the ready step, applies the default decision, and renders final output', async () => {
    const { host } = buildHost();
    const { packets } = registerDefaultExecutor(host);

    const started = await host.startRun({
      'definition': buildDefinition(),
      'input': { 'company': 'Acme' },
    });
    const completed = await host.runUntilComplete({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
    });

    expect(started.reason).toBe('created');
    expect(completed.state.status).toBe('succeeded');
    expect(completed.final_output).toEqual({
      'summary': 'summary for Acme',
      'artifact': '/tmp/run_001.md',
    });
    expect(packets).toHaveLength(1);
    expect(await host.getRunState({ 'runId': 'run_001' })).toEqual(completed.state);
  });

  test('rejects missing runs', async () => {
    const { host } = buildHost();
    registerDefaultExecutor(host);

    let missingRunError: unknown;
    try {
      await host.runUntilComplete({ 'definition': buildDefinition(), 'runId': 'missing' });
    } catch (caught) {
      missingRunError = caught;
    }

    expect(missingRunError).toBeInstanceOf(RuntimeError);
    expect((missingRunError as RuntimeError).code).toBe('run_not_found');
  });

  test('runUntilComplete returns immediately when run is paused', async () => {
    const { host } = buildHost();
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    await host.pauseRun({ 'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect' });

    const result = await host.runUntilComplete({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(result.state.phase).toBe('paused');
    expect(result.final_output).toBeUndefined();
  });

  describe('getRunState', () => {
    test('returns the run state snapshot from the store', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      const state = await host.getRunState({ 'runId': started.state.run_id });

      expect(state.run_id).toBe('run_001');
      expect(state.phase).toBe('ready');
    });

    test('throws run_not_found for missing runs', async () => {
      const { host } = buildHost();

      let error: unknown;
      try {
        await host.getRunState({ 'runId': 'no_such_run' });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('run_not_found');
    });
  });

  describe('getCurrentStep', () => {
    test('returns the current step view for a ready run', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      const view = await host.getCurrentStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

      expect(view).not.toBeNull();
      expect(view!.step_id).toBe('step_a');
      expect(view!.attempt).toBe(1);
      expect(view!.step.id).toBe('step_a');
      expect(view!.step_state.status).toBe('active');
    });

    test('returns null for terminated runs', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      await host.terminateRun({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'runStatus': 'cancelled',
        'reason': 'test',
      });

      const view = await host.getCurrentStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });
      expect(view).toBeNull();
    });

    test('throws for mismatched definitions', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      const wrongDefinition = { ...buildDefinition(), 'sop_id': 'other' };

      let error: unknown;
      try {
        await host.getCurrentStep({ 'definition': wrongDefinition, 'runId': started.state.run_id });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('invalid_runtime_state');
    });
  });
});
