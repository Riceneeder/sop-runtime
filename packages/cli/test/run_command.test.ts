import {expect, test} from 'bun:test';

test('run command works', () => {
  const out = Bun.spawnSync(['bun', 'packages/cli/src/index.ts', 'run', 'examples/echo_sop_definition.json', '--input', 'examples/basic_input.json']);
  expect(out.exitCode).toBe(0);
});
