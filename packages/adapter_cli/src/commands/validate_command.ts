import {readFile} from 'node:fs/promises';
import {validateDefinition} from '@sop-exec/validator';

export interface CliResult {
  exit_code: number;
  stdout: string;
}

export async function runValidateCommand(path: string): Promise<CliResult> {
  const fileContent = await readFile(path, 'utf8');
  const definition = JSON.parse(fileContent) as Parameters<typeof validateDefinition>[0];
  const result = validateDefinition(definition);

  if (result.ok) {
    return {
      'exit_code': 0,
      'stdout': 'SOP definition is valid.',
    };
  }

  return {
    'exit_code': 1,
    'stdout': result.diagnostics
      .map((item) => `${item.code}: ${item.message}`)
      .join('\n'),
  };
}
