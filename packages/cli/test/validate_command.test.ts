import {expect, test} from 'bun:test';

test('validate command works', () => {
  const out = Bun.spawnSync(['bun', 'packages/cli/src/index.ts', 'validate', 'examples/basic_sop_definition.json']);
  expect(out.exitCode).toBe(0);
});
