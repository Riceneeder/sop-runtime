import {describe, expect, test} from 'bun:test';
import {
  ExpressionSyntaxError,
  parseExpressionBody,
  parseExpressionTemplate,
} from '../src/index.js';

describe('expression parser', () => {
  test('parses references, literals, and coalesce expressions', () => {
    expect(parseExpressionBody('run.input.company')).toEqual({
      'kind': 'reference',
      'source': 'run_input',
      'path': ['company'],
      'raw': 'run.input.company',
    });

    expect(parseExpressionBody('steps.search_news.output.articles')).toEqual({
      'kind': 'reference',
      'source': 'step_output',
      'step_id': 'search_news',
      'path': ['articles'],
      'raw': 'steps.search_news.output.articles',
    });

    expect(parseExpressionBody('coalesce(steps.a.output.x, "fallback", [])')).toEqual({
      'kind': 'coalesce',
      'expressions': [
        {
          'kind': 'reference',
          'source': 'step_output',
          'step_id': 'a',
          'path': ['x'],
          'raw': 'steps.a.output.x',
        },
        {
          'kind': 'literal',
          'value': 'fallback',
        },
        {
          'kind': 'literal',
          'value': [],
        },
      ],
    });
  });

  test('parses template strings and keeps quoted commas inside coalesce arguments', () => {
    expect(parseExpressionTemplate('before ${coalesce("a,b", run.input.company)} after')).toEqual([
      {'kind': 'text', 'value': 'before '},
      {
        'kind': 'expression',
        'expression': {
          'kind': 'coalesce',
          'expressions': [
            {'kind': 'literal', 'value': 'a,b'},
            {
              'kind': 'reference',
              'source': 'run_input',
              'path': ['company'],
              'raw': 'run.input.company',
            },
          ],
        },
      },
      {'kind': 'text', 'value': ' after'},
    ]);
  });

  test('rejects malformed expressions', () => {
    expect(() => parseExpressionBody('steps.only_two_parts')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpressionBody('coalesce(')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpressionBody('coalesce(run.input.company,)')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpressionTemplate('${}')).toThrow(ExpressionSyntaxError);
  });
});
