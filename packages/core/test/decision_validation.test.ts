import {describe, expect, test} from 'bun:test';
import {CoreError, applyDecision} from '../src/index.js';
import {buildDefinition, runAwaitingDecision} from './apply_decision_test_helpers.js';

describe('applyDecision validation', () => {
  test('rejects invalid outcomes', () => {
    const definition = buildDefinition();
    const awaitingDecision = runAwaitingDecision(definition);
    let error: unknown;

    try {
      applyDecision({
        definition,
        'state': awaitingDecision,
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'missing',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('decision_rejected');
    expect((error as CoreError).details?.outcome_id).toBe('missing');
  });

  test('rejects a definition that does not match the persisted run SOP id/version', () => {
    const definition = buildDefinition();
    const awaitingDecision = runAwaitingDecision(definition);

    let error: unknown;
    try {
      applyDecision({
        'definition': {
          ...definition,
          'sop_id': 'other_definition',
        },
        'state': awaitingDecision,
        'decision': {
          'run_id': 'run_001',
          'step_id': 'step_a',
          'attempt': 1,
          'outcome_id': 'continue',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe('invalid_state');
  });
});
