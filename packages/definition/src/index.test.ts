import {describe, expect, test} from 'bun:test';
import {
  JsonObject,
  RUN_PHASES,
  RUN_STATUSES,
  RunState,
  SopDefinition,
} from './index';

describe('definition exports', () => {
  test('exports the shared SOP model types and constants', () => {
    const input: JsonObject = {'company': 'Acme'};
    const definition: SopDefinition = {
      'sop_id': 'news_report',
      'name': 'News Report',
      'version': '1.0.0',
      'entry_step': 'search_news',
      'input_schema': {'type': 'object'},
      'policies': {
        'cooldown_secs': 0,
        'max_run_secs': 60,
        'idempotency_key_template': 'news:${run.input.company}',
        'concurrency': {
          'mode': 'singleflight',
          'key_template': 'news:${run.input.company}',
        },
      },
      'steps': [],
      'final_output': {'summary': 'ok'},
    };
    const state = {} as RunState;

    expect(input.company).toBe('Acme');
    expect(definition.sop_id).toBe('news_report');
    expect(state).toBeDefined();
    expect(RUN_STATUSES).toContain('running');
    expect(RUN_PHASES).toContain('ready');
  });
});
