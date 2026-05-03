# `@sop-runtime/validator`

`@sop-runtime/validator` 是 SOP 定义的 admission check 层。它接收一个 `SopDefinition` 风格的对象，按固定顺序执行结构、语义和表达式三类校验，最后返回统一的 `ValidationResult`。

## 什么时候读

当你需要判断一份 SOP definition 为什么能被接受或为什么被拒绝时，读这个包。若只是需要一份可通过校验的输入样例，先看[根 README](../../README.md) 和 [`examples/basic_sop_definition.json`](../../examples/basic_sop_definition.json)。

## 包定位

这个包只做一件事：校验 SOP 定义能否被系统接受。

它不负责：

- 定义 SOP 模型本身
- 解析运行时状态机
- 真正执行步骤

它依赖 [`@sop-runtime/definition`](../definition/README.md) 提供类型、表达式解析器和若干共享常量。

## 对外暴露内容

公共入口是 [`src/index.ts`](./src/index.ts)，对外只暴露两个东西：

- `validateDefinition(definition)`：顶层校验入口
- `Diagnostic` / `ValidationResult`：统一诊断结果模型

典型使用方式：

```ts
import {validateDefinition} from '@sop-runtime/validator';

const result = validateDefinition(definition);

if (!result.ok) {
  console.log(result.diagnostics);
}
```

返回结果模型很简单：

- `ok`：是否完全通过
- `diagnostics`：所有发现的问题

每条 `Diagnostic` 都包含：

- `code`：稳定的机器可读错误码
- `message`：面向人的错误说明
- `path`：定位到定义内部具体字段的路径

## 核心概念

### 1. 结构校验

结构校验检查字段形状、必填项、基本类型、枚举值、模式匹配和对象额外字段。它回答的是“这份输入长得像不像一个 SOP 定义”。

### 2. 语义校验

语义校验检查跨字段关系是否一致，例如：

- `entry_step` 是否真的存在
- `step.id` 是否重复
- `allowed_outcomes` 和 `transitions` 是否一一对应
- `next_step` 是否指向了真实步骤

它回答的是“这份定义内部引用关系是否自洽”。

### 3. 表达式校验

表达式校验检查模板中的 `${...}` 引用是否合法，例如：

- 引用了不存在的输入字段
- 引用了不存在的步骤输出字段
- `final_output` 引用了不可达步骤
- 模板表达式语法本身就有问题

它回答的是“模板表达式能否在这份定义上下文里成立”。

## 文件清单与职责

### 源码与配置文件

| 文件                                                                     | 作用                                                           | 直接依赖                                                  | 谁会依赖它                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| [`package.json`](./package.json)                                       | 定义包名、模块类型，并声明对 `@sop-runtime/definition` 的 workspace 依赖。     | 无                                                     | 包管理器、工作区解析                                              |
| [`tsconfig.json`](./tsconfig.json)                                     | 指定构建输入输出目录，并通过 `references` 声明对 definition 包的编译依赖。         | 根 `tsconfig.base.json`、`../definition`                | TypeScript 构建                                            |
| [`src/index.ts`](./src/index.ts)                                       | 公共入口，只重新导出顶层校验 API 和诊断类型。                                | `diagnostic.ts`、`validate_definition.ts`              | 外部调用者、测试                                               |
| [`src/diagnostic.ts`](./src/diagnostic.ts)                             | 定义 `Diagnostic` 与 `ValidationResult`，统一所有校验阶段的输出形状。        | 无                                                     | `validate_definition.ts`、各校验器、`index.ts`                 |
| [`src/path.ts`](./src/path.ts)                                         | 把嵌套对象位置格式化为稳定的诊断路径字符串。                                   | 无                                                     | 各校验模块                                                    |
| [`src/schema_validator.ts`](./src/schema_validator.ts)                 | 结构层校验的公共门面，委托给 `schema_sections.ts`、`schema_require.ts`、`schema_keys.ts` 等专门模块。 | `@sop-runtime/definition`、`diagnostic.ts`、`schema_sections.ts` | `validate_definition.ts`                                   |
| [`src/schema_sections.ts`](./src/schema_sections.ts)                   | 按 definition 的顶层区域（root、policies、steps、final_output）分段校验。  | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts`、`schema_keys.ts`、`schema_require.ts`、`schema_type_detect.ts`、`schema_step_details.ts` | `schema_validator.ts`                                      |
| [`src/schema_keys.ts`](./src/schema_keys.ts)                           | 定义各层级的字段白名单和必填集合。                                         | `@sop-runtime/definition`                             | `schema_sections.ts`                                       |
| [`src/schema_require.ts`](./src/schema_require.ts)                     | Required 字段校验辅助。                                            | `diagnostic.ts`、`path.ts`                            | `schema_sections.ts`                                       |
| [`src/schema_type_detect.ts`](./src/schema_type_detect.ts)             | 基础类型检测（string、number、object、array、boolean）。                | 无                                                     | `schema_sections.ts`                                       |
| [`src/schema_path_resolver.ts`](./src/schema_path_resolver.ts)         | 在嵌套 definition 对象中按路径查找字段值。                                | 无                                                     | `schema_sections.ts`                                       |
| [`src/schema_step_details.ts`](./src/schema_step_details.ts)           | Step 内部详细字段的结构校验。                                          | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts`、`schema_keys.ts` | `schema_sections.ts`                                       |
| [`src/semantic_validator.ts`](./src/semantic_validator.ts)             | 负责语义层校验，包括步骤图、outcome 和 transition 之间的关系。                | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts` | `validate_definition.ts`                                   |
| [`src/expression_validator.ts`](./src/expression_validator.ts)         | 表达式校验的公共门面，委托给 `expression_reference_validator.ts`、`expression_template_walk.ts`、`step_reachability.ts`。 | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts`、`expression_reference_validator.ts`、`expression_template_walk.ts`、`step_reachability.ts` | `validate_definition.ts`                                   |
| [`src/expression_reference_validator.ts`](./src/expression_reference_validator.ts) | 校验模板表达式中的引用路径（run.input、steps.\<id\>.output、steps.\<id\>.artifacts）是否合法。 | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts` | `expression_validator.ts`                                  |
| [`src/expression_template_walk.ts`](./src/expression_template_walk.ts) | 遍历 definition 字段中的模板字符串，调用解析器和引用校验器。                     | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts`、`expression_reference_validator.ts` | `expression_validator.ts`                                   |
| [`src/step_reachability.ts`](./src/step_reachability.ts)               | 计算从 entry_step 出发可达的步骤集合，供 expression validator 过滤 final_output 引用。 | `@sop-runtime/definition`                            | `expression_validator.ts`                                   |
| [`src/runtime_schema_validator.ts`](./src/runtime_schema_validator.ts) | 运行时 JSON Schema 子集校验入口，校验运行时输入/输出/result 是否符合 definition 中的 schema 声明。 | `@sop-runtime/definition`、`diagnostic.ts`、`path.ts`、`runtime_type_validators.ts`、`runtime_value_validators.ts` | `@sop-runtime/core`                                        |
| [`src/runtime_type_validators.ts`](./src/runtime_type_validators.ts)   | JSON Schema 类型匹配的运行时实现（type check、enum、required、pattern 等）。 | `@sop-runtime/definition`                             | `runtime_schema_validator.ts`                               |
| [`src/runtime_value_validators.ts`](./src/runtime_value_validators.ts) | 运行时值校验的便捷函数（`validateRuntimeValue`）。                          | `@sop-runtime/definition`、`runtime_schema_validator.ts` | `@sop-runtime/core`                                        |
| [`src/validate_definition.ts`](./src/validate_definition.ts)           | 顶层编排器；按固定顺序串联三类校验并汇总结果。                                 | `@sop-runtime/definition`、`diagnostic.ts`、三个子校验器       | `index.ts`                                                 |

### 测试文件

| 文件                                                             | 作用         | 关注点                     |
| -------------------------------------------------------------- | ---------- | ----------------------- |
| [`test/index.test.ts`](./test/index.test.ts)                     | 验证公共入口导出核心类型。 | 顶层入口、诊断类型导出                                   |
| [`test/validate_definition_schema.test.ts`](./test/validate_definition_schema.test.ts) | 结构层校验测试。 | 顶层字段、策略字段、执行器字段的结构校验 |
| [`test/validate_definition_semantic.test.ts`](./test/validate_definition_semantic.test.ts) | 语义层校验测试。 | allowed_outcomes / transitions / entry_step 语义校验 |
| [`test/validate_definition_expression.test.ts`](./test/validate_definition_expression.test.ts) | 表达式校验测试。 | 输入/输出字段引用、可达性、模板语法 |
| [`test/validate_definition_executor.test.ts`](./test/validate_definition_executor.test.ts) | 执行器配置校验测试。 | executor kind/name/config、超时和环境约束 |
| [`test/validate_definition_executor_expression.test.ts`](./test/validate_definition_executor_expression.test.ts) | 执行器相关表达式引用校验测试。 | exec config 中 expression 不做解释的行为 |
| [`test/validate_definition_malformed.test.ts`](./test/validate_definition_malformed.test.ts) | 畸形输入鲁棒性测试。 | null、undefined、非对象输入、空数组、额外字段 |
| [`test/validate_definition_reachability.test.ts`](./test/validate_definition_reachability.test.ts) | 步骤可达性校验测试。 | final_output 引用不可达步骤、分支路径可达性 |
| [`test/validate_definition_schema_path.test.ts`](./test/validate_definition_schema_path.test.ts) | 诊断路径输出测试。 | 嵌套错误的 path 格式化和稳定性 |
| [`test/validate_definition_step.test.ts`](./test/validate_definition_step.test.ts) | 步骤定义校验测试。 | step id 重复、缺失字段、output_schema 结构 |
| [`test/runtime_schema_validator.test.ts`](./test/runtime_schema_validator.test.ts) | 运行时 schema 校验测试。 | 运行时输入/输出类型校验、enum/required/pattern 匹配 |
| [`test/example_definition.test.ts`](./test/example_definition.test.ts) | 仓库级 example definition 通过性测试。 | `examples/basic_sop_definition.json` 通过 validateDefinition |

### 构建产物与缓存

| 文件/目录                  | 作用                             | 是否推荐直接阅读            |
| ---------------------- | ------------------------------ | ------------------- |
| `dist/*.js`            | TypeScript 编译后的 JavaScript 输出。 | 不推荐，除非你在排查构建结果      |
| `dist/*.d.ts`          | TypeScript 声明文件。               | 可以用于核对导出面，但不是源码事实来源 |
| `tsconfig.tsbuildinfo` | TypeScript 增量编译缓存。             | 不推荐                 |

## 依赖顺序

这个包有一条较宽但清晰的内部依赖链：

```text
diagnostic      path
   │             │
   ├──────┬──────┬──────────────────────┐
   │      │      │                      │
schema (facade)  semantic    expression (facade)
   │              │              │
schema_keys      (inline)   expression_reference_validator
schema_require                expression_template_walk
schema_type_detect            step_reachability
schema_path_resolver
schema_step_details           runtime_schema_validator
schema_sections               runtime_type_validators
   │                          runtime_value_validators
   ├──────────┬───────────────┘
   │          │
validate_definition
   │
  index
```

还要再叠加一层外部依赖：

```text
@sop-runtime/definition
├── 提供 SopDefinition 类型
├── 提供 RETRYABLE_STEP_RESULT_STATUSES
├── 提供表达式解析器与错误类型
└── 提供表达式 AST 类型
```

## 调用顺序

顶层校验的执行顺序是固定的，定义在 [`src/validate_definition.ts`](./src/validate_definition.ts)：

```text
输入 definition
  -> validateSchemaDefinition
  -> validateSemanticDefinition
  -> validateExpressionDefinition
  -> ValidationResult
```

这意味着：

- 结构问题最先被发现
- 语义问题其次
- 表达式问题最后

阅读代码时也最好尊重这个顺序，因为这是包真正运行时的主流程。

## 推荐阅读顺序

### 如果你是包使用者

推荐顺序：

1. [`src/index.ts`](./src/index.ts)
2. [`src/diagnostic.ts`](./src/diagnostic.ts)
3. [`src/validate_definition.ts`](./src/validate_definition.ts)
4. 按需读按行为命名的测试文件（`validate_definition_schema.test.ts`、`validate_definition_semantic.test.ts` 等）

这样可以先知道“怎么调用、会返回什么、整体流程是什么、测试怎样描述预期行为”。

### 如果你是仓库内开发者

推荐顺序：

1. [`src/diagnostic.ts`](./src/diagnostic.ts)
2. [`src/path.ts`](./src/path.ts)
3. [`src/schema_validator.ts`](./src/schema_validator.ts) → 然后深入 `schema_sections.ts`、`schema_keys.ts`、`schema_require.ts` 等
4. [`src/semantic_validator.ts`](./src/semantic_validator.ts)
5. [`src/expression_validator.ts`](./src/expression_validator.ts) → 然后深入 `expression_reference_validator.ts`、`expression_template_walk.ts`、`step_reachability.ts`
6. [`src/validate_definition.ts`](./src/validate_definition.ts)
7. [`src/index.ts`](./src/index.ts)
8. 按需读对应测试文件

如果你还想理解表达式校验为什么这么做，建议先补读 definition 包中的 [`expression_ast.ts`](../definition/src/expression_ast.ts)、[`expression_body_parser.ts`](../definition/src/expression_body_parser.ts) 和 [`sop_definition.ts`](../definition/src/sop_definition.ts)。

## 测试文件说明

validator 的测试文件按能力拆分为多个独立模块，形成行为说明书。主要覆盖：

- **结构层**：顶层字段、策略字段、执行器字段的结构校验（`validate_definition_schema.test.ts`）
- **语义层**：`allowed_outcomes` / `transitions` / `entry_step` 的语义校验（`validate_definition_semantic.test.ts`）
- **表达式层**：输入字段引用、输出字段引用、模板语法错误（`validate_definition_expression.test.ts`）
- **执行器层**：executor kind/name/config 校验（`validate_definition_executor.test.ts`）
- **可达性**：final_output 引用不可达步骤（`validate_definition_reachability.test.ts`）
- **畸形输入**：null、undefined、非对象输入等鲁棒性（`validate_definition_malformed.test.ts`）
- **诊断路径**：嵌套错误的 path 格式化和稳定性（`validate_definition_schema_path.test.ts`）
- **运行时校验**：运行时输入/输出/decision/result 的 schema 子集校验（`runtime_schema_validator.test.ts`）
- **通过性**：仓库级 `examples/basic_sop_definition.json` 通过 validateDefinition（`example_definition.test.ts`）

如果你想快速知道“系统认为哪些输入是非法的”，直接读按行为命名的测试文件最省时间。

## 与 `@sop-runtime/definition` 的关系

两个包之间的边界非常明确：

- `@sop-runtime/definition` 负责定义模型和表达式语法
- `@sop-runtime/validator` 负责基于这些模型和语法做合法性判断

因此，validator 的很多规则都不是凭空产生的，而是直接建立在 definition 包的导出之上：

- 结构校验依赖 `SopDefinition` 和 `RETRYABLE_STEP_RESULT_STATUSES`
- 表达式校验依赖 `parseExpressionTemplate`、`ExpressionSyntaxError` 和表达式 AST
- `tsconfig.json` 也通过 project reference 明确声明了这一层依赖

如果你要同时阅读两个包，推荐先看 [`../definition/README.md`](../definition/README.md)，再看本 README。
