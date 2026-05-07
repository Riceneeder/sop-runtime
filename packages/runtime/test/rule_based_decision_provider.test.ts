import { describe, expect, test } from 'bun:test';
import { AcceptedStepResult, RunState, SopDefinition } from '@sop-runtime/definition';
import { RuleBasedDecisionProvider } from '../src/rule_based_decision_provider.js';
import { RuntimeError } from '../src/index.js';

function makeDefinition(allowedOutcomeIds: string[] = ['done', 'escalate']): SopDefinition {
  const transitions: Record<string, { terminate: { run_status: 'succeeded' | 'failed'; reason: string } }> = {};
  for (const id of allowedOutcomeIds) {
    transitions[id] = { terminate: { run_status: id === 'done' ? 'succeeded' : 'failed', reason: `outcome ${id}` } };
  }
  return {
    sop_id: 'test_sop',
    name: 'Test SOP',
    version: '1.0.0',
    entry_step: 'step_a',
    input_schema: { type: 'object', properties: {}, additionalProperties: true },
    policies: {
      cooldown_secs: 0,
      max_run_secs: 0,
      idempotency_key_template: 'test:default',
      concurrency: { mode: 'allow_parallel', key_template: 'test:default' },
    },
    final_output: {},
    steps: [
      {
        id: 'step_a',
        title: 'Step A',
        inputs: {},
        executor: {
          kind: 'tool',
          name: 'test_tool',
          timeout_secs: 60,
          allow_network: false,
          env: {},
          resource_limits: { max_output_bytes: 1024, max_artifacts: 0 },
        },
        output_schema: { type: 'object', properties: {}, additionalProperties: true },
        retry_policy: { max_attempts: 1, backoff_secs: [], retry_on: [] },
        supervision: {
          owner: 'main_agent',
          allowed_outcomes: allowedOutcomeIds.map((id) => ({ id, description: `Outcome ${id}` })),
          default_outcome: allowedOutcomeIds[0] ?? 'done',
        },
        transitions,
      },
    ],
  };
}

function makeRunState(overrides: Partial<RunState> & { accepted_result?: AcceptedStepResult } = {}): RunState {
  const acceptedResult: AcceptedStepResult = overrides.accepted_result ?? {
    step_id: 'step_a',
    attempt: 1,
    status: 'success',
    output: { flag: true, route: 'done' },
  };
  const { accepted_result: _ar, ...rest } = overrides;
  return {
    run_id: 'run_001',
    sop_id: 'test_sop',
    sop_version: '1.0.0',
    status: 'running',
    phase: 'awaiting_decision',
    run_input: {},
    entry_step_id: 'step_a',
    current_step_id: 'step_a',
    current_attempt: 1,
    steps: {
      step_a: { step_id: 'step_a', status: 'waiting_decision', attempt_count: 1 },
    },
    accepted_results: { step_a: acceptedResult },
    history: [
      { kind: 'run_created', step_id: 'step_a' },
      { kind: 'step_result_accepted', step_id: 'step_a', attempt: 1, result_status: 'success' },
    ],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:01.000Z',
    ...rest,
  };
}

describe('RuleBasedDecisionProvider', () => {
  test('first matching rule wins', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: '${steps.step_a.output.flag}', outcome_id: 'done', reason: 'flag is truthy' },
        { when: 'true', outcome_id: 'escalate' },
      ],
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    });
    expect(result.outcome_id).toBe('done');
    expect(result.reason).toBe('flag is truthy');
  });

  test('second rule matches when first is falsy', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: '${false}', outcome_id: 'done' },
        { when: 'true', outcome_id: 'escalate', reason: 'fallback rule' },
      ],
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    });
    expect(result.outcome_id).toBe('escalate');
    expect(result.reason).toBe('fallback rule');
  });

  test('uses fallback_outcome_id when no rule matches', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: '${false}', outcome_id: 'done' },
      ],
      fallback_outcome_id: 'escalate',
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    });
    expect(result.outcome_id).toBe('escalate');
    expect(result.reason).toBe('fallback decision');
  });

  test('throws when no rule matches and no fallback', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: '${false}', outcome_id: 'done' },
      ],
    });
    const input = {
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    };
    try {
      await provider.decide(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('throws when rule outcome is not in allowed_outcomes', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: 'true', outcome_id: 'unknown_outcome' },
      ],
    });
    try {
      await provider.decide({
        definition: makeDefinition(),
        state: makeRunState(),
        accepted_result: makeRunState().accepted_results.step_a!,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('throws when fallback outcome is not in allowed_outcomes', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [],
      fallback_outcome_id: 'not_allowed',
    });
    try {
      await provider.decide({
        definition: makeDefinition(),
        state: makeRunState(),
        accepted_result: makeRunState().accepted_results.step_a!,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('throws when current_step_id is null', async () => {
    const provider = new RuleBasedDecisionProvider({ rules: [] });
    try {
      await provider.decide({
        definition: makeDefinition(),
        state: makeRunState({ current_step_id: null }),
        accepted_result: makeRunState().accepted_results.step_a!,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('throws when current_attempt is null', async () => {
    const provider = new RuleBasedDecisionProvider({ rules: [] });
    try {
      await provider.decide({
        definition: makeDefinition(),
        state: makeRunState({ current_attempt: null }),
        accepted_result: makeRunState().accepted_results.step_a!,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('throws when step not in definition', async () => {
    const def = makeDefinition();
    const provider = new RuleBasedDecisionProvider({ rules: [] });
    try {
      await provider.decide({
        definition: { ...def, steps: [] },
        state: makeRunState(),
        accepted_result: makeRunState().accepted_results.step_a!,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).code).toBe('invalid_runtime_state');
    }
  });

  test('when evaluates to falsy values: false, 0, "", null', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [
        { when: '${false}', outcome_id: 'done' },
        { when: '${steps.step_a.output.zero}', outcome_id: 'done' },
        { when: '${steps.step_a.output.empty_str}', outcome_id: 'done' },
        { when: '${steps.step_a.output.nil}', outcome_id: 'done' },
        { when: 'true', outcome_id: 'escalate', reason: 'only this matches' },
      ],
      fallback_outcome_id: 'done',
    });
    const state = makeRunState({
      accepted_result: { step_id: 'step_a', attempt: 1, status: 'success', output: { zero: 0, empty_str: '', nil: null } },
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state,
      accepted_result: state.accepted_results.step_a!,
    });
    expect(result.outcome_id).toBe('escalate');
  });

  test('reason defaults to "rule-based decision" when not provided', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [{ when: 'true', outcome_id: 'done' }],
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    });
    expect(result.reason).toBe('rule-based decision');
  });

  test('empty rules with fallback works', async () => {
    const provider = new RuleBasedDecisionProvider({
      rules: [],
      fallback_outcome_id: 'done',
    });
    const result = await provider.decide({
      definition: makeDefinition(),
      state: makeRunState(),
      accepted_result: makeRunState().accepted_results.step_a!,
    });
    expect(result.outcome_id).toBe('done');
    expect(result.reason).toBe('fallback decision');
  });
});
