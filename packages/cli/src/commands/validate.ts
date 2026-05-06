import {SopDefinition} from '@sop-runtime/definition';
import {validateDefinition} from '@sop-runtime/validator';
import {print, readJson} from '../cli.js';

export function runValidate(definitionPath: string | undefined): void {
  const definition = readJson<SopDefinition>(definitionPath);
  const result = validateDefinition(definition);
  print(result);
  process.exit(result.ok ? 0 : 1);
}
