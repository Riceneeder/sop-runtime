import { describe, expect, test } from 'bun:test';
import {
  DecisionProvider,
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeError,
  RuntimeHost,
} from '../src/index.js';
import {
  buildDefinition,
  buildHost,
  FixedClock,
  RecordingEventSink,
  registerDefaultExecutor,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('RuntimeHost', () => {
  test('emits run_terminated events for normal terminal transitions', async () => {
    const eventSink = new RecordingEventSink();
    const { host } = buildHost({ eventSink });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    await host.runUntilComplete({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(eventSink.events.map((event) => event.kind)).toContain('run_terminated');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_terminated',
      'run_id': 'run_001',
      'details': { 'run_status': 'succeeded', 'reason': 'complete' },
    });
  });

  test('pauses a run and emits run_paused event', async () => {
    const eventSink = new RecordingEventSink();
    const { host } = buildHost({ eventSink });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const paused = await host.pauseRun({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
      'reason': 'manual inspection',
    });

    expect(paused.phase).toBe('paused');
    expect(paused.pause?.reason).toBe('manual inspection');
    expect(paused.pause?.previous_phase).toBe('ready');
    expect(eventSink.events.map((e) => e.kind)).toContain('run_paused');
    expect(eventSink.events.at(-1)).toMatchObject({
      'kind': 'run_paused',
      'run_id': 'run_001',
      'details': { 'reason': 'manual inspection' },
    });
  });

  test('resumes a paused run and emits run_resumed event', async () => {
    const eventSink = new RecordingEventSink();
    const { host } = buildHost({ eventSink });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    await host.pauseRun({ 'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect' });

    const resumed = await host.resumeRun({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(resumed.phase).toBe('ready');
    expect(resumed.pause).toBeUndefined();
    expect(eventSink.events.map((e) => e.kind)).toContain('run_resumed');
    expect(eventSink.events.at(-1)).toMatchObject({ 'kind': 'run_resumed', 'run_id': 'run_001' });
  });

  test('terminates a run and emits run_terminated event', async () => {
    const eventSink = new RecordingEventSink();
    const { host } = buildHost({ eventSink });
    registerDefaultExecutor(host);

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    const terminated = await host.terminateRun({
      'definition': buildDefinition(),
      'runId': started.state.run_id,
      'runStatus': 'cancelled',
      'reason': 'operator cancelled',
    });

    expect(terminated.phase).toBe('terminated');
    expect(terminated.status).toBe('cancelled');
    expect(terminated.terminal).toEqual({ 'run_status': 'cancelled', 'reason': 'operator cancelled' });
    expect(eventSink.events.map((e) => e.kind)).toContain('run_terminated');
  });

  describe('decideOutcome', () => {
    test('builds and applies a decision from the current accepted result', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });

      // Execute the step first to get an accepted result
      await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

      // Now decide the outcome
      const nextState = await host.decideOutcome({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'outcomeId': 'done',
        'reason': 'test decision',
      });

      expect(nextState.status).toBe('succeeded');
      expect(nextState.phase).toBe('terminated');
    });

    test('emits decision_applied and run_terminated events', async () => {
      const eventSink = new RecordingEventSink();
      const { host } = buildHost({ eventSink });
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

      await host.decideOutcome({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'outcomeId': 'done',
      });

      const kinds = eventSink.events.map((e) => e.kind);
      expect(kinds).toContain('decision_applied');
      expect(kinds).toContain('run_terminated');
    });

    test('respects max_run_secs before applying the decision', async () => {
      const clock = new FixedClock('2026-04-20T12:00:00.000Z');
      const definition = buildDefinition({ 'max_run_secs': 1 });
      const host = new RuntimeHost({
        'store': new InMemoryStateStore(),
        'decisionProvider': new DefaultDecisionProvider(),
        clock,
        'idGenerator': new SequentialIdGenerator(),
      });
      registerDefaultExecutor(host);

      const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
      await host.runReadyStep({ definition, 'runId': started.state.run_id });

      clock.setNow('2026-04-20T12:00:02.000Z');
      const expired = await host.decideOutcome({
        definition,
        'runId': started.state.run_id,
        'outcomeId': 'done',
      });

      expect(expired.status).toBe('failed');
      expect(expired.terminal?.reason).toBe('max_run_secs_exceeded');
    });
  });

  describe('applyDecision compatibility', () => {
    test('applyDecision still works as a compat entry point', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

      const nextState = await host.applyDecision({
        'definition': buildDefinition(),
        'runId': started.state.run_id,
        'decision': {
          'run_id': started.state.run_id,
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'done',
          'reason': 'compat test',
        },
      });

      expect(nextState.status).toBe('succeeded');
    });
  });

  describe('decision rejection on paused runs', () => {
    test('applyDecision throws when run is paused', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      await host.pauseRun({ 'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect' });

      let error: unknown;
      try {
        await host.applyDecision({ 'definition': buildDefinition(), 'runId': started.state.run_id });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('invalid_runtime_state');
    });

    test('decideOutcome throws when run is paused', async () => {
      const { host } = buildHost();
      registerDefaultExecutor(host);

      const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
      await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });
      await host.pauseRun({ 'definition': buildDefinition(), 'runId': started.state.run_id, 'reason': 'inspect' });

      let error: unknown;
      try {
        await host.decideOutcome({
          'definition': buildDefinition(),
          'runId': started.state.run_id,
          'outcomeId': 'done',
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe('invalid_runtime_state');
    });

    test('applyDecision on paused run does not call DecisionProvider', async () => {
      let providerCalled = false;
      const provider: DecisionProvider = {
        async decide() {
          providerCalled = true;
          return {
            'run_id': '',
            'step_id': '',
            'attempt': 1,
            'outcome_id': 'done',
          };
        },
      };
      const definition = buildDefinition();
      const store = new InMemoryStateStore();
      const clock = new FixedClock('2026-04-20T12:00:00.000Z');
      const host = new RuntimeHost({ store, 'decisionProvider': provider, clock });
      registerDefaultExecutor(host);

      const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
      await host.runReadyStep({ definition, 'runId': started.state.run_id });
      await host.pauseRun({ definition, 'runId': started.state.run_id, 'reason': 'inspect' });

      try { await host.applyDecision({ definition, 'runId': started.state.run_id }); } catch { /* expected */ }

      expect(providerCalled).toBe(false);
    });
  });
});
