import {expect, test} from 'bun:test';

const cli = ['bun', 'packages/cli/src/index.ts'];

test('trace valid definition exits 0 and prints trace info', () => {
  const out = Bun.spawnSync([...cli, 'trace', 'examples/basic_sop_definition.json', '--input', 'examples/basic_input.json']);
  expect(out.exitCode).toBe(0);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(true);
  expect(typeof parsed.run_id).toBe('string');
  expect(typeof parsed.sop_id).toBe('string');
  expect(typeof parsed.version).toBe('string');
  expect(typeof parsed.phase).toBe('string');
  expect(typeof parsed.current_step_id).toBe('string');
  expect(parsed.packet).toBeDefined();
});

test('trace without --input exits 1', () => {
  const out = Bun.spawnSync([...cli, 'trace', 'examples/basic_sop_definition.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
});

test('trace with input not matching schema exits 1', () => {
  const out = Bun.spawnSync([...cli, 'trace', 'examples/basic_sop_definition.json', '--input', 'packages/cli/test/fixtures/invalid_input.json']);
  expect(out.exitCode).toBe(1);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.ok).toBe(false);
});
