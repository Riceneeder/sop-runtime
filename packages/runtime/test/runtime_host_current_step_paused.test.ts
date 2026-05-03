import {describe, expect, test} from 'bun:test';
import {
  buildDefinition,
  buildHost,
  registerDefaultExecutor,
  FixedClock,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost getCurrentStep with paused runs', () => {
  test('startRun then pauseRun returns active step', async () => {
    const definition = buildDefinition();
    const { host } = buildHost({
      'clock': new FixedClock('2026-04-20T12:00:00Z'),
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    expect(started.state.phase).toBe('ready');

    const paused = await host.pauseRun({
      definition,
      'runId': started.state.run_id,
      'reason': 'manual inspection',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.previous_phase).toBe('ready');

    const view = await host.getCurrentStep({
      definition,
      'runId': started.state.run_id,
    });

    expect(view).not.toBeNull();
    expect(view!.step_id).toBe('step_a');
    expect(view!.attempt).toBe(1);
    expect(view!.step_state.status).toBe('active');
  });

  test('runReadyStep then pauseRun returns waiting_decision step', async () => {
    const definition = buildDefinition();
    const { host } = buildHost({
      'clock': new FixedClock('2026-04-20T12:00:00Z'),
      'idGenerator': new SequentialIdGenerator(),
    });
    registerDefaultExecutor(host);

    const started = await host.startRun({
      definition,
      'input': {'company': 'Acme'},
    });

    const awaitingDecision = await host.runReadyStep({
      definition,
      'runId': started.state.run_id,
    });

    expect(awaitingDecision.phase).toBe('awaiting_decision');

    const paused = await host.pauseRun({
      definition,
      'runId': started.state.run_id,
      'reason': 'review needed',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.previous_phase).toBe('awaiting_decision');

    const view = await host.getCurrentStep({
      definition,
      'runId': started.state.run_id,
    });

    expect(view).not.toBeNull();
    expect(view!.step_id).toBe('step_a');
    expect(view!.attempt).toBe(1);
    expect(view!.step_state.status).toBe('waiting_decision');
  });
});
