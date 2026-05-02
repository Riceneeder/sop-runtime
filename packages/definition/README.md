# `@sop-runtime/definition`

`@sop-runtime/definition` 是 SOP 执行系统里的“共享定义层”。它不负责真正执行步骤，也不做 admission check；它的职责是提供一套稳定的类型、常量和表达式解析能力，供其他包复用。

## 什么时候读

当你需要确认 SOP definition、运行时状态、step result、decision 或模板表达式 AST 的字段契约时，读这个包。若只是想先跑通完整流程，建议从[根 README](../../README.md) 和 [`examples/basic_sop_definition.json`](../../examples/basic_sop_definition.json) 开始。

## 包定位

这个包提供四类能力：

- SOP DSL 类型：例如 `SopDefinition`、`StepDefinition`、`ExecutorConfig`。
- 运行时模型：例如 `RunState`、`StepResult`、`Decision`。
- 表达式解析：例如 `parseExpressionTemplate`、`parseExpressionBody`、`ExpressionSyntaxError`。
- 最小 Builder API：`defineSop`，提供类型约束的 SOP authoring 辅助。

它本身不做校验；校验职责在 [`@sop-runtime/validator`](../validator/README.md)。

## 对外暴露内容

对外入口是 [`src/index.ts`](./src/index.ts)。从这个入口可以拿到以下几组导出：

- JSON 基础类型：`JsonPrimitive`、`JsonArray`、`JsonObject`、`JsonValue`
- SOP 定义类型：`SopDefinition`、`StepDefinition`、`Transition`、`RetryPolicy`、`ExecutorConfig`（通用 `kind` + `name` 引用，`config` 可选）等
- 运行时状态类型：`RunState`、`RunStatus`、`RunPhase`（含 `paused`）、`HistoryEntry`、`StepState` 等
- 执行结果类型：`StepResult`、`AcceptedStepResult`、`StepPacket`、`Decision`、`StepRun` 等
- 常量集合：`RUN_STATUSES`、`RUN_PHASES`、`STEP_LIFECYCLES`、`EXECUTOR_RESULT_STATUSES`、`ACCEPTED_STEP_RESULT_STATUSES`、`RETRYABLE_STEP_RESULT_STATUSES`
- 表达式解析能力：`parseExpressionTemplate`、`parseExpressionBody`、`ExpressionSyntaxError` 以及表达式 AST 类型
- Builder API：`defineSop`，类型约束 identity 函数

典型导入方式：

```ts
import {defineSop, parseExpressionTemplate, RUN_STATUSES} from '@sop-runtime/definition';
```

### `defineSop` 使用说明

```ts
import {defineSop} from '@sop-runtime/definition';

const definition = defineSop({
  'sop_id': 'example',
  'name': 'Example',
  'version': '1.0.0',
  'entry_step': 'step_a',
  'input_schema': {'type': 'object', 'required': ['key'], 'properties': {'key': {'type': 'string'}}},
  'policies': {
    'cooldown_secs': 0,
    'max_run_secs': 60,
    'idempotency_key_template': 'ex:${run.input.key}',
    'concurrency': {'mode': 'singleflight', 'key_template': 'ex:${run.input.key}'},
  },
  'steps': [{
    'id': 'step_a',
    'title': 'Step A',
    'inputs': {'key': '${run.input.key}'},
    'executor': {
      'kind': 'tool', 'name': 'process',
      'timeout_secs': 30, 'allow_network': false, 'env': {},
      'resource_limits': {'max_output_bytes': 1024, 'max_artifacts': 0},
    },
    'output_schema': {},
    'retry_policy': {'max_attempts': 1, 'backoff_secs': [], 'retry_on': []},
    'supervision': {
      'owner': 'main_agent',
      'allowed_outcomes': [{'id': 'done', 'description': 'finish'}],
      'default_outcome': 'done',
    },
    'transitions': {
      'done': {'terminate': {'run_status': 'succeeded', 'reason': 'done'}},
    },
  }],
  'final_output': {'key': '${steps.step_a.output.result}'},
});
```

重要说明：
- `defineSop` 返回普通 `SopDefinition` 对象，不做校验。
- 使用者仍应调用 `validateDefinition` 进行准入检查。
- 更多示例可参考 [`examples/basic_sop_definition.json`](../../examples/basic_sop_definition.json)。

## 核心概念

### 1. 定义模型

定义模型描述“一个 SOP 长什么样”。核心入口是 `SopDefinition`，它包含：

- 顶层身份信息：`sop_id`、`name`、`version`
- 输入与策略：`input_schema`、`defaults`、`policies`
- 步骤图：`steps`、`entry_step`
- 最终输出：`final_output`

### 2. 运行时模型

运行时模型描述“一个 SOP 跑起来以后会记录什么状态”。这部分按粒度拆成：

- 执行侧数据：`StepPacket`、`StepResult`、`AcceptedStepResult`
- 决策侧数据：`Decision`
- 全局运行快照：`RunState`

### 3. 表达式模型

表达式模型描述模板字符串里的 `${...}` 片段如何被解析成 AST。它只负责解析，不负责校验引用是否合法。引用合法性由 validator 包处理。

## 文件清单与职责

下表按“源码 / 测试 / 构建产物”区分，重点解释每个文件的角色。

### 源码与配置文件

| 文件                                                 | 作用                                           | 直接依赖                                                                              | 谁会依赖它                                                             |
| -------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`package.json`](./package.json)                   | 定义包名、模块类型和工作区身份。这个包目前是私有 workspace 包。        | 无                                                                                 | 包管理器、工作区解析                                                        |
| [`tsconfig.json`](./tsconfig.json)                 | 指定 `src` 为源码目录、`dist` 为构建输出目录。               | 根 `tsconfig.base.json`                                                            | TypeScript 构建                                                     |
| [`src/index.ts`](./src/index.ts)                   | 公共导出入口；把内部模块重新导出给外部使用者。                      | `run_state.ts`、`execution.ts`、`json_value.ts`、`sop_definition.ts`、`expression.ts` | 其他包、测试                                                            |
| [`src/json_value.ts`](./src/json_value.ts)         | 定义全包最底层的 JSON 类型系统。                          | 无                                                                                 | `sop_definition.ts`、`execution.ts`、`run_state.ts`、`expression.ts` |
| [`src/sop_definition.ts`](./src/sop_definition.ts) | 定义 SOP DSL：步骤、转移、执行器、策略等 authoring-time 模型。  | `json_value.ts`                                                                   | `execution.ts`、`index.ts`、validator 包                             |
| [`src/execution.ts`](./src/execution.ts)           | 定义执行器请求/响应、监督决策、步骤运行记录等 execution-time 数据结构。 | `sop_definition.ts`、`json_value.ts`                                               | `run_state.ts`、`index.ts`                                         |
| [`src/run_state.ts`](./src/run_state.ts)           | 定义整次运行的状态快照、历史事件和状态常量。                       | `execution.ts`、`json_value.ts`                                                    | `index.ts`、未来 runtime/core 包                                      |
| [`src/expression.ts`](./src/expression.ts)         | 定义表达式 AST，并实现模板解析器和语法错误类型。                   | `json_value.ts`                                                                   | `index.ts`、validator 包                                            |
| [`src/builder.ts`](./src/builder.ts)               | 最小 Builder API：`defineSop` 类型约束 identity。            | `sop_definition.ts`                                                              | `index.ts`、使用 TS authoring 的调用方                                      |

### 测试文件

| 文件                                                   | 作用                     | 关注点                                             |
| ---------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| [`src/index.test.ts`](./src/index.test.ts)           | 检查公共导出是否完整、联合类型是否正确收窄。 | 包入口、类型导出、常量导出                                   |
| [`src/expression.test.ts`](./src/expression.test.ts) | 检查表达式解析器的 AST 形态和错误处理。 | `parseExpressionBody`、`parseExpressionTemplate` |

### 构建产物与缓存

| 文件/目录                  | 作用                             | 是否推荐直接阅读               |
| ---------------------- | ------------------------------ | ---------------------- |
| `dist/*.js`            | TypeScript 编译后的 JavaScript 输出。 | 不推荐，除非你在排查构建结果         |
| `dist/*.d.ts`          | TypeScript 声明文件。               | 可以在验证导出结果时查看，但不是源码事实来源 |
| `tsconfig.tsbuildinfo` | TypeScript 增量编译缓存。             | 不推荐                    |

## 依赖顺序

如果把这个包理解成一张依赖图，顺序是：

```text
json_value
├── sop_definition
│   └── execution
│       └── run_state
└── expression

index
├── json_value
├── sop_definition
├── execution
├── run_state
└── expression
```

可以把它理解为两条主线：

- 类型主线：`json_value -> sop_definition -> execution -> run_state`
- 表达式主线：`json_value -> expression`

最后由 `index.ts` 把两条主线聚合成外部可用 API。

## 推荐阅读顺序

### 如果你是包使用者

推荐顺序：

1. [`src/index.ts`](./src/index.ts)：先看包到底导出了什么
2. [`src/sop_definition.ts`](./src/sop_definition.ts)：理解 SOP 定义层模型
3. [`src/builder.ts`](./src/builder.ts)：理解 `defineSop` Builder API 的使用方式
4. [`src/execution.ts`](./src/execution.ts)：理解执行和结果数据
5. [`src/run_state.ts`](./src/run_state.ts)：理解整次运行状态
6. [`src/expression.ts`](./src/expression.ts)：只有在你需要模板表达式时再读

### 如果你是仓库内开发者

推荐顺序：

1. [`src/json_value.ts`](./src/json_value.ts)
2. [`src/sop_definition.ts`](./src/sop_definition.ts)
3. [`src/builder.ts`](./src/builder.ts)
4. [`src/execution.ts`](./src/execution.ts)
5. [`src/run_state.ts`](./src/run_state.ts)
6. [`src/expression.ts`](./src/expression.ts)
7. [`src/index.ts`](./src/index.ts)
8. [`src/index.test.ts`](./src/index.test.ts)
9. [`src/expression.test.ts`](./src/expression.test.ts)

这样读的原因是：先理解最稳定的基础类型，再看 SOP 模型和 Builder API，再看运行时模型，最后再回头看入口聚合和测试覆盖。

## 测试文件说明

这个包的测试分两层：

- [`src/index.test.ts`](./src/index.test.ts) 偏“对外契约测试”
  - 它验证使用者能否从 `index.ts` 拿到正确的导出
  - 它还验证联合类型的区分和约束是否符合预期
- [`src/expression.test.ts`](./src/expression.test.ts) 偏“内部算法测试”
  - 它验证模板切分、引用解析、`coalesce(...)` 参数拆分和异常分支

如果你只想判断包的公开能力有没有变，先看 `index.test.ts`；如果你在追表达式行为，再看 `expression.test.ts`。

## 与 `@sop-runtime/validator` 的关系

两个包的关系是“定义层”和“校验层”的关系：

- `@sop-runtime/definition` 负责声明“数据长什么样”
- `@sop-runtime/validator` 负责判断“这份定义是否合法”

更具体地说，validator 会直接复用本包中的：

- `SopDefinition`
- `RETRYABLE_STEP_RESULT_STATUSES`
- `parseExpressionTemplate`
- `ExpressionSyntaxError`
- 表达式 AST 类型

因此，想理解 validator 为什么这么校验，通常应该先读这个包，尤其是 [`src/sop_definition.ts`](./src/sop_definition.ts) 和 [`src/expression.ts`](./src/expression.ts)。
