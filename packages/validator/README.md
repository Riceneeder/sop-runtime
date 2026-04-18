# `@sop-exec/validator`

`@sop-exec/validator` 是 SOP 定义的 admission check 层。它接收一个 `SopDefinition` 风格的对象，按固定顺序执行结构、语义和表达式三类校验，最后返回统一的 `ValidationResult`。

## 包定位

这个包只做一件事：校验 SOP 定义能否被系统接受。

它不负责：

- 定义 SOP 模型本身
- 解析运行时状态机
- 真正执行步骤

它依赖 [`@sop-exec/definition`](../definition/README.md) 提供类型、表达式解析器和若干共享常量。

## 对外暴露内容

公共入口是 [`src/index.ts`](./src/index.ts)，对外只暴露两个东西：

- `validateDefinition(definition)`：顶层校验入口
- `Diagnostic` / `ValidationResult`：统一诊断结果模型

典型使用方式：

```ts
import {validateDefinition} from '@sop-exec/validator';

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

| 文件                                                             | 作用                                                    | 直接依赖                                             | 谁会依赖它                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| [`package.json`](./package.json)                               | 定义包名、模块类型，并声明对 `@sop-exec/definition` 的 workspace 依赖。 | 无                                                | 包管理器、工作区解析                                                              |
| [`tsconfig.json`](./tsconfig.json)                             | 指定构建输入输出目录，并通过 `references` 声明对 definition 包的编译依赖。    | 根 `tsconfig.base.json`、`../definition`           | TypeScript 构建                                                           |
| [`src/index.ts`](./src/index.ts)                               | 公共入口，只重新导出顶层校验 API 和诊断类型。                             | `diagnostic.ts`、`validate_definition.ts`         | 外部调用者、测试                                                                |
| [`src/diagnostic.ts`](./src/diagnostic.ts)                     | 定义 `Diagnostic` 与 `ValidationResult`，统一所有校验阶段的输出形状。   | 无                                                | `validate_definition.ts`、各校验器、`index.ts`                                |
| [`src/path.ts`](./src/path.ts)                                 | 把嵌套对象位置格式化为稳定的诊断路径字符串。                                | 无                                                | `schema_validator.ts`、`semantic_validator.ts`、`expression_validator.ts` |
| [`src/schema_validator.ts`](./src/schema_validator.ts)         | 负责结构层校验，包括字段白名单、类型、枚举、正则和最小约束。                        | `@sop-exec/definition`、`diagnostic.ts`、`path.ts` | `validate_definition.ts`                                                |
| [`src/semantic_validator.ts`](./src/semantic_validator.ts)     | 负责语义层校验，包括步骤图、outcome 和 transition 之间的关系。             | `@sop-exec/definition`、`diagnostic.ts`、`path.ts` | `validate_definition.ts`                                                |
| [`src/expression_validator.ts`](./src/expression_validator.ts) | 负责模板表达式校验，复用 definition 包里的表达式解析器和 AST。               | `@sop-exec/definition`、`diagnostic.ts`、`path.ts` | `validate_definition.ts`                                                |
| [`src/validate_definition.ts`](./src/validate_definition.ts)   | 顶层编排器；按固定顺序串联三类校验并汇总结果。                               | `@sop-exec/definition`、`diagnostic.ts`、三个子校验器    | `index.ts`                                                              |

### 测试文件

| 文件                                         | 作用         | 关注点                     |
| ------------------------------------------ | ---------- | ----------------------- |
| [`src/index.test.ts`](./src/index.test.ts) | 覆盖整个包的主行为。 | 顶层入口、诊断路径、结构/语义/表达式三层校验 |

### 构建产物与缓存

| 文件/目录                  | 作用                             | 是否推荐直接阅读            |
| ---------------------- | ------------------------------ | ------------------- |
| `dist/*.js`            | TypeScript 编译后的 JavaScript 输出。 | 不推荐，除非你在排查构建结果      |
| `dist/*.d.ts`          | TypeScript 声明文件。               | 可以用于核对导出面，但不是源码事实来源 |
| `tsconfig.tsbuildinfo` | TypeScript 增量编译缓存。             | 不推荐                 |

## 依赖顺序

这个包有一条很清晰的内部依赖链：

```text
diagnostic      path
   │             │
   ├──────┬──────┤
   │      │      │
schema  semantic  expression
   │      │         │
   └──────┴─────────┘
          │
validate_definition
          │
        index
```

还要再叠加一层外部依赖：

```text
@sop-exec/definition
├── 提供 SopDefinition 类型
├── 提供 RETRYABLE_STEP_RESULT_STATUSES
└── 提供表达式解析器与错误类型
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
4. [`src/index.test.ts`](./src/index.test.ts)

这样可以先知道“怎么调用、会返回什么、整体流程是什么、测试怎样描述预期行为”。

### 如果你是仓库内开发者

推荐顺序：

1. [`src/diagnostic.ts`](./src/diagnostic.ts)
2. [`src/path.ts`](./src/path.ts)
3. [`src/schema_validator.ts`](./src/schema_validator.ts)
4. [`src/semantic_validator.ts`](./src/semantic_validator.ts)
5. [`src/expression_validator.ts`](./src/expression_validator.ts)
6. [`src/validate_definition.ts`](./src/validate_definition.ts)
7. [`src/index.ts`](./src/index.ts)
8. [`src/index.test.ts`](./src/index.test.ts)

如果你还想理解表达式校验为什么这么做，建议在第 5 步之前先补读 [`packages/definition/src/expression.ts`](../definition/src/expression.ts) 和 [`packages/definition/src/sop_definition.ts`](../definition/src/sop_definition.ts)。

## 测试文件说明

这个包目前只有一份主测试文件 [`src/index.test.ts`](./src/index.test.ts)，但它覆盖范围很广，基本就是整个包的行为说明书。它主要覆盖：

- 顶层与嵌套诊断路径是否稳定
- 顶层字段、策略字段、执行器字段的结构校验
- `allowed_outcomes` / `transitions` / `entry_step` 的语义校验
- 表达式语法、输入字段引用、输出字段引用、可达性校验

如果你想快速知道“系统认为哪些输入是非法的”，直接读这份测试最省时间。

## 与 `@sop-exec/definition` 的关系

两个包之间的边界非常明确：

- `@sop-exec/definition` 负责定义模型和表达式语法
- `@sop-exec/validator` 负责基于这些模型和语法做合法性判断

因此，validator 的很多规则都不是凭空产生的，而是直接建立在 definition 包的导出之上：

- 结构校验依赖 `SopDefinition` 和 `RETRYABLE_STEP_RESULT_STATUSES`
- 表达式校验依赖 `parseExpressionTemplate`、`ExpressionSyntaxError` 和表达式 AST
- `tsconfig.json` 也通过 project reference 明确声明了这一层依赖

如果你要同时阅读两个包，推荐先看 [`../definition/README.md`](../definition/README.md)，再看本 README。
