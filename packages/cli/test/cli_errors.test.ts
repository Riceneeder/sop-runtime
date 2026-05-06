import {expect, test} from 'bun:test';

const cli = ['bun', 'packages/cli/src/index.ts'];

test('unknown command exits 1', () => {
  const out = Bun.spawnSync([...cli, 'oops']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
  expect(parsed.error.code).toBe('cli_error');
});

test('invalid JSON definition exits 1', () => {
  const out = Bun.spawnSync([...cli, 'validate', 'packages/cli/test/fixtures/invalid_sop.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
});

test('missing definition file exits 1', () => {
  const out = Bun.spawnSync([...cli, 'validate', 'packages/cli/test/fixtures/nonexistent.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
});
