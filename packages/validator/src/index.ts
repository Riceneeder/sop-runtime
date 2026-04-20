/**
 * @packageDocumentation
 *
 * Public entrypoint for the validator package.
 *
 * `@sop-runtime/validator` 的公共导出入口。
 */
export type {Diagnostic, ValidationResult} from './diagnostic';
export {validateRuntimeValue} from './runtime_schema_validator';
export {validateDefinition} from './validate_definition';
