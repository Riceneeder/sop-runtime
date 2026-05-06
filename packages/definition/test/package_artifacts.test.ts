import {expect, test} from 'bun:test';
import {existsSync} from 'node:fs';

test('schema and example artifacts exist in package', () => {
  expect(existsSync('packages/definition/schemas/sop-definition.schema.json')).toBe(true);
  expect(existsSync('packages/definition/examples/basic_sop_definition.json')).toBe(true);
});
