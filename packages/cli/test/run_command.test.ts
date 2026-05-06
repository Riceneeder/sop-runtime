import {expect, test} from 'bun:test';

const cli = ['bun', 'packages/cli/src/index.ts'];

test('run echo example exits 0 and prints result', () => {
  const out = Bun.spawnSync([...cli, 'run', 'examples/echo_sop_definition.json', '--input', 'examples/basic_input.json']);
  expect(out.exitCode).toBe(0);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(true);
  expect(parsed.state).toBeDefined();
});

test('run without --input exits 1', () => {
  const out = Bun.spawnSync([...cli, 'run', 'examples/echo_sop_definition.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
});

test('run with unregistered executor exits 1 and reports executor_not_registered', () => {
  const out = Bun.spawnSync([...cli, 'run', 'packages/cli/test/fixtures/unknown_executor_sop.json', '--input', 'packages/cli/test/fixtures/invalid_input.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
  expect(parsed.error.code).toBe('executor_not_registered');
});
