import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, test} from 'bun:test';
import {validateDefinition} from './index.js';

describe('example definition admission', () => {
  test('basic_sop_definition.json passes admission check', () => {
    const examplePath = resolve(import.meta.dirname, '../../../examples/basic_sop_definition.json');
    const definition = JSON.parse(readFileSync(examplePath, 'utf8'));
    const result = validateDefinition(definition);

    expect(result).toEqual({'ok': true, 'diagnostics': []});
  });
});
