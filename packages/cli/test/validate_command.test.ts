import {expect, test} from 'bun:test';

const cli = ['bun', 'packages/cli/src/index.ts'];

test('validate valid definition exits 0 and prints ok:true', () => {
  const out = Bun.spawnSync([...cli, 'validate', 'examples/basic_sop_definition.json']);
  expect(out.exitCode).toBe(0);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(true);
  expect(Array.isArray(parsed.diagnostics)).toBe(true);
});

test('validate invalid definition exits 1 and prints ok:false', () => {
  const out = Bun.spawnSync([...cli, 'validate', 'packages/cli/test/fixtures/invalid_sop.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
  expect(Array.isArray(parsed.diagnostics)).toBe(true);
});

test('--pretty flag formats JSON with indentation', () => {
  const out = Bun.spawnSync([...cli, '--pretty', 'validate', 'examples/basic_sop_definition.json']);
  expect(out.exitCode).toBe(0);
  const stdout = out.stdout.toString();
  expect(stdout).toInclude('\n  ');
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
});
