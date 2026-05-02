/**
 * Minimal Builder API for authoring SOP definitions.
 *
 * `defineSop` is a type-constrained identity: it accepts a SopDefinition
 * and returns the same plain JSON object.  Validation is handled by
 * `@sop-runtime/validator` — this function does not validate, transform,
 * or silently repair the input.
 *
 * `defineSop` 是类型约束的恒等函数：接收 SopDefinition 并原样返回。
 * 校验由 `@sop-runtime/validator` 负责，本函数不校验、不转换、不静默修复。
 */
import {SopDefinition} from './sop_definition.js';

/**
 * Declare a SOP definition with full TypeScript type checking.
 *
 * 用完整的 TypeScript 类型检查声明一个 SOP 定义。
 *
 * @param definition - SOP definition object conforming to the SopDefinition interface.
 * @returns The same definition object, returned unchanged.
 */
export function defineSop(definition: SopDefinition): SopDefinition {
  return definition;
}
