import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';

test('schema artifact has expected top-level fields', () => {
  const raw = readFileSync('packages/definition/schemas/sop-definition.schema.json', 'utf8');
  const schema = JSON.parse(raw);
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.type).toBe('object');
  expect(typeof schema.title).toBe('string');
  expect(typeof schema.properties).toBe('object');
  expect(Array.isArray(schema.required)).toBe(true);
  expect(schema.required).toContain('sop_id');
  expect(schema.required).toContain('steps');
});

test('example artifact has expected top-level fields', () => {
  const raw = readFileSync('packages/definition/examples/basic_sop_definition.json', 'utf8');
  const example = JSON.parse(raw);
  expect(typeof example.sop_id).toBe('string');
  expect(typeof example.version).toBe('string');
  expect(Array.isArray(example.steps)).toBe(true);
  expect(typeof example.input_schema).toBe('object');
});
