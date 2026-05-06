import {SopDefinition} from '@sop-runtime/definition';
import {validateDefinition} from '@sop-runtime/validator';
import {CliOptions, print, readJson} from '../cli.js';

export function runValidate(definitionPath: string | undefined, opts: CliOptions): void {
  const definition = readJson<SopDefinition>(definitionPath);
  const result = validateDefinition(definition);
  print(result, opts);
  process.exit(result.ok ? 0 : 1);
}
