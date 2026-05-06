import {expect, test} from 'bun:test';

test('unknown command fails', () => {
  const out = Bun.spawnSync(['bun', 'packages/cli/src/index.ts', 'oops']);
  expect(out.exitCode).toBe(1);
});
