import {CliResult, runValidateCommand} from './commands/validate_command';

function renderUsage(): CliResult {
  return {
    'exit_code': 1,
    'stdout': [
      'Usage:',
      '  bun run cli validate <path-to-definition.json>',
    ].join('\n'),
  };
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const [command, path] = argv;
  if (command !== 'validate' || !path) {
    return renderUsage();
  }

  return runValidateCommand(path);
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));
  console.log(result.stdout);
  process.exit(result.exit_code);
}
