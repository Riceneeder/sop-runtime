/**
 * Shared diagnostic model returned by validator passes.
 *
 * 校验器各阶段共用的诊断模型定义。
 *
 * @public
 */
export interface Diagnostic {
  /**
   * Stable machine-readable diagnostic code.
   *
   * 机器可读且稳定的诊断编码。
   */
  code: string;
  /**
   * Human-readable error message.
   *
   * 面向人的错误说明。
   */
  message: string;
  /**
   * Dot-style path that points to the invalid definition field.
   *
   * 指向出错字段的点路径。
   */
  path: string;
}

/**
 * Aggregate result returned by the top-level validator.
 *
 * 顶层校验入口返回的聚合结果。
 *
 * @public
 */
export interface ValidationResult {
  /**
   * Whether the definition passed every validation stage.
   *
   * 定义是否通过所有校验阶段。
   */
  ok: boolean;
  /**
   * Collected diagnostics from schema, semantic, and expression validation.
   *
   * 来自结构、语义和表达式校验的诊断集合。
   */
  diagnostics: Diagnostic[];
}
