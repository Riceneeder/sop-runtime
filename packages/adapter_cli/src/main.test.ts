import {describe, expect, test} from 'bun:test';

describe('runCli', () => {
  test('returns usage text when no command is provided', async () => {
    const module = await import('./index');
    const runCli = module.runCli as
      | ((argv: string[]) => Promise<{exit_code: number; stdout: string}>)
      | undefined;

    const result = await (runCli?.([]) ?? Promise.resolve({
      'exit_code': 0,
      'stdout': '',
    }));

    expect(result.exit_code).toBe(1);
    expect(result.stdout).toContain('validate');
  });
});
