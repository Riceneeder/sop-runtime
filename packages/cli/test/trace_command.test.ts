import {expect, test} from 'bun:test';

test('trace command works', () => {
  const out = Bun.spawnSync(['bun', 'packages/cli/src/index.ts', 'trace', 'examples/basic_sop_definition.json', '--input', 'examples/basic_input.json']);
  expect(out.exitCode).toBe(0);
});
