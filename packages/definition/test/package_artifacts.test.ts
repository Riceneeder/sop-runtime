import {expect, test} from 'bun:test';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';

const PKG_DIR = 'packages/definition';

test('schema artifact has expected top-level fields', () => {
  const raw = readFileSync(`${PKG_DIR}/schemas/sop-definition.schema.json`, 'utf8');
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
  const raw = readFileSync(`${PKG_DIR}/examples/basic_sop_definition.json`, 'utf8');
  const example = JSON.parse(raw);
  expect(typeof example.sop_id).toBe('string');
  expect(typeof example.version).toBe('string');
  expect(Array.isArray(example.steps)).toBe(true);
  expect(typeof example.input_schema).toBe('object');
});

test('package exports map points to existing files', () => {
  const raw = readFileSync(`${PKG_DIR}/package.json`, 'utf8');
  const pkg = JSON.parse(raw);
  const exports = pkg.exports;

  const schemaExport = exports['./schema/sop-definition.schema.json'];
  expect(typeof schemaExport).toBe('string');
  expect(existsSync(resolve(PKG_DIR, schemaExport))).toBe(true);

  const exampleExport = exports['./examples/basic_sop_definition.json'];
  expect(typeof exampleExport).toBe('string');
  expect(existsSync(resolve(PKG_DIR, exampleExport))).toBe(true);
});

test('package files array includes schema and example directories', () => {
  const raw = readFileSync(`${PKG_DIR}/package.json`, 'utf8');
  const pkg = JSON.parse(raw);
  expect(pkg.files).toContain('schemas');
  expect(pkg.files).toContain('examples');
});
