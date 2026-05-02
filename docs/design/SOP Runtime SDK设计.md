# SOP Runtime SDK 设计

> 创建时间：2026-05-01
> 状态：v1-alpha 目标架构规范

## 1. 定位

`sop-runtime` 的目标是成为一个可嵌入的 SOP SDK。它提供稳定的 SOP definition 协议、校验器、纯状态机语义和运行时控制 API，让上层可以开发：

- CLI 工具
- MCP 服务
- Codex / Agent 插件
- Agent skill
- 业务系统内嵌的 SOP 执行能力

SDK 本身不绑定具体 Agent 框架、LLM、沙箱、命令行工具、软件工具或存储系统。外部系统通过 SDK 暴露的端口与注册表接入能力。

核心目标是：

- 让 agent 能把经验工作流固化成 `sop.json`。
- 让 agent 能作为 SOP 的监管者显式控制流程。
- 让 SOP 执行可预测、可校验、可审计、可恢复。
- 让每个步骤的执行者由外部注册，而不是由 SDK 固定。

## 2. 设计原则

### 2.1 SDK 是底座，不是宿主产品

SDK 只提供稳定协议和运行时能力。CLI、插件、skill、MCP server、具体 agent adapter 都应构建在 SDK 之上。

### 2.2 Agent 是监管者

在 agent 场景中，agent 负责：

- 触发 SOP run
- 读取运行状态
- 决定是否执行当前步骤
- 选择 outcome
- 触发 retry
- 暂停、恢复、终止 run
- 做最终验收

SDK 负责：

- 校验 `sop.json`
- 创建和保存 run 状态
- 构建 step packet
- 分发给已注册执行者
- 接纳 step result
- 校验 outcome 和 transition 是否预声明
- 推进状态机
- 暴露审计事件和 hook 点

### 2.3 SOP 是声明式非线性流程

SOP 可以跳转、重试、提前终止，但所有路径都必须在 definition 中预声明。

执行者和 hook 都不能直接指定下一步。真正的路由只能由：

1. SOP 中声明的 `supervision.allowed_outcomes`
2. SOP 中声明的 `transitions`
3. Agent 对 outcome 的显式选择

共同决定。

### 2.4 执行者外部注册

每一步的执行者可以是 LLM、子 agent、command、脚本、软件工具、远程 API 或业务系统动作。SDK 不内置这些执行方式的具体实现。

SDK 只提供 `kind + name` 注册和分发机制：

- `kind` 表示执行类别，例如 `llm`、`sub_agent`、`command`、`script`、`tool`。
- `name` 表示宿主注册的具体执行者，例如 `gpt_reporter`、`local_shell`、`web_search`。
- `config` 是执行者私有 JSON 配置，由注册的 handler 自己解释。

### 2.5 Hook 只能受控介入

v1-alpha 只开放 step 前后 hook：

- `beforeStep`
- `afterStep`

Hook 可以观察、改写 packet 或 result，也可以请求暂停或终止 run。但 hook 不能：

- 动态插入步骤
- 改写 transition table
- 选择 outcome
- 直接设置 next step
- 绕过 core 的校验

## 3. 分层架构

SDK 内部继续保持单向依赖：

```text
definition -> validator -> core -> runtime
```

### 3.1 definition

定义所有共享协议类型：

- `SopDefinition`
- `StepDefinition`
- `ExecutorConfig`
- `RunState`
- `StepPacket`
- `StepResult`
- `Decision`
- `FinalOutput`
- 表达式 AST 与解析器

这一层只描述协议，不做校验、不推进状态、不访问外部系统。

### 3.2 validator

负责 SOP definition 的准入校验：

- JSON Schema 结构校验
- 跨字段语义校验
- 表达式引用校验
- 运行时 JSON Schema 子集校验

validator 不执行步骤，也不修改 run state。

### 3.3 core

负责纯状态机语义：

- 创建 run
- 构建 step packet
- 接纳 step result
- 应用 decision
- pause / resume / manual terminate 的纯状态迁移
- 渲染 final output

core 不访问文件、网络、数据库、环境变量、Agent SDK 或沙箱。

### 3.4 runtime

负责把 core 和外部端口组装成可运行 SDK：

- `RuntimeHost`
- `StateStore`
- executor registry
- hook pipeline
- event sink
- clock / id generator / logger

runtime 不实现具体 CLI、MCP server、Agent 插件或沙箱。

### 3.5 adapter / driver

适配层在 SDK 之外实现：

- CLI adapter
- MCP adapter
- Agent plugin
- skill
- sandbox adapter
- SQLite / Postgres / Redis store
- LLM / command / tool executor handler

## 4. SOP JSON 规范

`sop.json` 是 SDK 的一等协议产物。SDK 必须提供：

- JSON Schema
- 字段语义说明
- 完整示例
- TypeScript Builder API

当前 v1-alpha 中，结构层 JSON Schema 以 [`schemas/sop-definition.schema.json`](../../schemas/sop-definition.schema.json) 形式存放在仓库根目录。完整的参考示例如 [`examples/basic_sop_definition.json`](../../examples/basic_sop_definition.json)，该示例通过 validator 测试覆盖。两者目前均属于仓库级工件，不作为 workspace package export 发布。远程 schema URL、npm package schema path、CLI 分发路径等发布策略不在当前范围内。

### 4.1 顶层结构

一份 SOP definition 至少包含：

```json
{
  "$schema": "../schemas/sop-definition.schema.json",
  "sop_id": "company_news_report",
  "name": "公司新闻日报",
  "version": "1.0.0",
  "entry_step": "search_news",
  "input_schema": {},
  "defaults": {},
  "policies": {},
  "steps": [],
  "final_output": {}
}
```

关键字段语义：

- `sop_id`：稳定 SOP 标识。
- `version`：SOP 版本，RuntimeHost 必须用它校验 definition 和 persisted run 是否匹配。
- `entry_step`：首次进入的 step id。
- `input_schema`：run input 的 JSON Schema-like 合约。
- `defaults`：run input 默认值，创建 run 时与调用方 input 合并。
- `policies`：run 级策略，包括幂等、并发、冷却、最大运行时长。
- `steps`：所有步骤定义。
- `final_output`：成功终止后渲染的输出模板。

### 4.2 Step 结构

每个 step 至少包含：

```json
{
  "id": "search_news",
  "title": "搜索新闻",
  "inputs": {
    "company": "${run.input.company}"
  },
  "executor": {
    "kind": "tool",
    "name": "web_search",
    "config": {
      "query_template": "${company} news"
    },
    "timeout_secs": 60,
    "allow_network": true,
    "env": {},
    "resource_limits": {
      "max_output_bytes": 65536,
      "max_artifacts": 8
    }
  },
  "output_schema": {
    "type": "object"
  },
  "retry_policy": {
    "max_attempts": 3,
    "backoff_secs": [1, 5],
    "retry_on": ["timeout", "tool_error", "invalid_output", "sandbox_error"]
  },
  "supervision": {
    "owner": "main_agent",
    "allowed_outcomes": [
      {"id": "continue", "description": "继续下一步"},
      {"id": "retry", "description": "重试当前步骤"},
      {"id": "fail_run", "description": "终止为失败"}
    ],
    "default_outcome": "continue"
  },
  "transitions": {
    "continue": {"next_step": "summarize"},
    "retry": {"next_step": "search_news"},
    "fail_run": {
      "terminate": {
        "run_status": "failed",
        "reason": "news_search_failed"
      }
    }
  }
}
```

### 4.3 ExecutorConfig

目标 executor 结构为通用协议：

```ts
export interface ExecutorConfig {
  kind: string;
  name: string;
  config?: JsonObject;
  timeout_secs: number;
  allow_network: boolean;
  env: Record<string, string>;
  resource_limits: ResourceLimits;
}
```

约束：

- `kind` 和 `name` 必须是非空字符串。
- SDK 用 `kind + name` 查找已注册 handler。
- `config` 可省略；如果提供，必须是 JSON object。
- `StepPacket.executor.config` 保留 definition 中的原始形态，不作模板渲染。
- RuntimeHost 传给 handler 的独立 `config` convenience 字段在缺省时为 `{}`。
- SDK 不解释 `config` 的业务含义，只保证它可序列化。
- `timeout_secs`、`env`、`allow_network`、`resource_limits` 是 SDK 和 adapter 共享的通用约束。

### 4.4 表达式

v1-alpha 支持最小表达式能力：

- `${run.input.xxx}`
- `${steps.<step_id>.output.xxx}`
- `${steps.<step_id>.artifacts.xxx}`
- `${coalesce(a, b, fallback)}`

表达式可用于：

- step `inputs`
- `final_output`
- policy key template（`idempotency_key_template`、`concurrency.key_template`）

`executor.config` 是 handler-owned opaque data，SDK 不解释其中的模板语法。如果具体 adapter 需要在 config 内定义模板字段，由对应 handler 自行解析（例如调用 `evaluateExpressionTemplate` 或使用自己的占位符语法）。

表达式不做条件判断、不执行函数副作用、不访问外部系统。

### 4.5 Builder API

Builder API 是 `sop.json` 的 TypeScript authoring 辅助，不是另一套协议。

目标：

- 产出普通 `SopDefinition` JSON object。
- 使用与 `sop.json` 相同的字段和语义。
- 不绕过 `validateDefinition`。
- 允许后续 CLI、agent、skill 用代码生成 SOP。

v1-alpha 提供最小形式，完整的一步 SOP 示例：

```ts
import {defineSop} from '@sop-runtime/definition';
import {validateDefinition} from '@sop-runtime/validator';

const definition = defineSop({
  'sop_id': 'basic_sop',
  'name': 'Basic SOP',
  'version': '1.0.0',
  'entry_step': 'collect_context',
  'input_schema': {
    'type': 'object',
    'required': ['ticket_id'],
    'properties': {
      'ticket_id': {'type': 'string'},
      'workspace': {'type': 'string'},
    },
  },
  'defaults': {'workspace': '/tmp/default'},
  'policies': {
    'cooldown_secs': 0,
    'max_run_secs': 300,
    'idempotency_key_template': 'basic:${run.input.ticket_id}',
    'concurrency': {
      'mode': 'singleflight',
      'key_template': 'basic:${run.input.ticket_id}',
    },
  },
  'steps': [{
    'id': 'collect_context',
    'title': 'Collect Context',
    'inputs': {
      'ticket_id': '${run.input.ticket_id}',
      'workspace': '${run.input.workspace}',
    },
    'executor': {
      'kind': 'tool',
      'name': 'collect_context',
      'config': {
        'command_template': 'collect-context --ticket ${ticket_id}',
      },
      'timeout_secs': 120,
      'allow_network': false,
      'env': {},
      'resource_limits': {'max_output_bytes': 4096, 'max_artifacts': 2},
    },
    'output_schema': {
      'type': 'object',
      'required': ['summary'],
      'properties': {'summary': {'type': 'string'}},
    },
    'retry_policy': {
      'max_attempts': 2,
      'backoff_secs': [5],
      'retry_on': ['tool_error', 'timeout'],
    },
    'supervision': {
      'owner': 'main_agent',
      'allowed_outcomes': [
        {'id': 'complete', 'description': 'Finish the run'},
      ],
      'default_outcome': 'complete',
    },
    'transitions': {
      'complete': {
        'terminate': {
          'run_status': 'succeeded',
          'reason': 'context_collected',
        },
      },
    },
  }],
  'final_output': {
    'summary': '${steps.collect_context.output.summary}',
  },
});

const result = validateDefinition(definition);
if (!result.ok) {
  throw new Error(JSON.stringify(result.diagnostics, null, 2));
}
```

`defineSop` 的职责是提供类型约束，返回普通 `SopDefinition` 对象：
- 不调用 `validateDefinition`（准入仍由 `@sop-runtime/validator` 负责）；
- 不转换、不 clone、不补默认值。

## 5. Runtime 控制 API

RuntimeHost 是 SDK 面向库集成者的主要入口。

### 5.1 Agent 监管 API

目标 API：

```ts
await host.startRun({definition, input});
await host.getRunState({runId});
await host.getCurrentStep({definition, runId});
await host.runReadyStep({definition, runId});
await host.decideOutcome({definition, runId, outcomeId, reason, metadata});
await host.pauseRun({definition, runId, reason});
await host.resumeRun({definition, runId});
await host.terminateRun({definition, runId, runStatus, reason});
await host.runUntilComplete({definition, runId});
```

语义：

- `startRun` 创建或复用 run。
- `getRunState` 返回持久化 run 快照。
- `getCurrentStep` 返回当前 step 视图，供 agent 决策和展示。
- `runReadyStep` 只在 `phase === "ready"` 时执行当前 step。
- `decideOutcome` 是 agent 监管者选择 outcome 的显式 API。
- `pauseRun` 只做检查点暂停，不硬取消正在运行的 executor。
- `resumeRun` 恢复到暂停前 phase。
- `terminateRun` 由 agent 显式终止 run。
- `runUntilComplete` 是本地嵌入和测试便利方法，不是 agent 监管场景的唯一入口。

控制面 API（`pauseRun`、`resumeRun`、`terminateRun`）需要调用方显式传入 `definition`，原因如下：

- runtime 需要校验传入 definition 的 `sop_id`/`version` 是否与持久化 run state 匹配。
- runtime 需要访问 definition 中的策略字段，例如 `max_run_secs`，以继续执行 host 级 policy enforcement。
- v1-alpha 不内置 definition registry，因此调用方必须在每个控制请求中携带 definition。

### 5.2 启动策略

`startRun` 必须通过 `StateStore.claimRunStart` 原子处理：

- run id 冲突
- idempotency key
- concurrency key
- cooldown

返回原因：

- `created`
- `idempotent_replay`
- `singleflight_joined`
- `dropped_running`
- `cooldown_active`

## 6. 状态模型

### 6.1 RunStatus

```ts
type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
```

### 6.2 RunPhase

```ts
type RunPhase = 'ready' | 'awaiting_decision' | 'paused' | 'terminated';
```

语义：

- `ready`：当前 step 可执行。
- `awaiting_decision`：step result 已被接纳，等待 agent 选择 outcome。
- `paused`：run 仍是 running，但必须由 agent 显式 resume、terminate 或 cancel。
- `terminated`：run 已进入终态。

### 6.3 Pause metadata

`RunState` 增加暂停信息：

```ts
interface PauseState {
  previous_phase: Exclude<RunPhase, 'paused' | 'terminated'>;
  reason?: string;
  paused_at?: string;
}
```

约束：

- `phase === "paused"` 时必须存在 `pause`。
- `resumeRun` 将 phase 恢复为 `pause.previous_phase`，并清除 `pause`。
- `pauseRun` 只能暂停非终止 run。需要调用方传入 definition 以验证 sop_id/version 一致性和访问策略配置。
- 已暂停 run 不能 build packet、accept result、apply decision。

### 6.4 Step lifecycle

Step lifecycle 继续描述单 step 状态：

- `pending`
- `active`
- `waiting_decision`
- `completed`
- `failed`

暂停是 run 级 phase，不是 step lifecycle。

## 7. Executor Registry

SDK 提供执行者注册表，用于把 SOP step 分发给外部能力。

### 7.1 注册模型

```ts
host.registerExecutor('tool', 'web_search', async (input) => {
  return {
    'run_id': input.packet.run_id,
    'step_id': input.packet.step_id,
    'attempt': input.packet.attempt,
    'status': 'success',
    'output': {},
    'artifacts': {},
  };
});
```

匹配规则：

- step 的 `executor.kind` 匹配注册时的 `kind`。
- step 的 `executor.name` 匹配注册时的 `name`。
- 未注册时必须明确失败，不能静默跳过。

### 7.2 Handler 输入

Handler 应接收：

- `packet`
- `definition`
- `state`
- `executor.config`

Handler 不应接收可写的 store、RuntimeHost 或内部状态引用。

### 7.3 Handler 输出

Handler 只能返回 `StepResult`。

禁止返回：

- outcome
- next step
- transition
- run status
- state patch

即使 handler 返回额外字段，core 也必须拒绝。

## 8. Hook 模型

v1-alpha 只开放 step 前后 hook。

### 8.1 beforeStep

运行时机：

1. RuntimeHost 从 core 构建 `StepPacket`
2. 执行 `beforeStep`
3. 如果 hook 继续，则调用 executor handler

能力：

- 观察 packet
- 改写 `inputs`
- 改写 `executor.config`
- 请求暂停
- 请求终止

限制：

- 不能改写 `run_id`
- 不能改写 `step_id`
- 不能改写 `attempt`
- 不能指定 outcome
- 不能指定 next step
- 不能返回 `transition`、`state` 等状态机字段

`beforeStep` 返回值只允许包含 `inputs`、`config`、`control`。`inputs` 和 `config` 必须是递归 JSON-safe object，不允许函数、`Date`、`Map`、`Infinity`、`undefined` 或循环引用。Hook 收到的是 `packet`、`definition`、`state` 的隔离副本，原地修改不会影响 core 后续判定。

### 8.2 afterStep

运行时机：

1. executor handler 返回 `StepResult`
2. 执行 `afterStep`
3. RuntimeHost 将最终 result 交给 core 接纳

能力：

- 观察 result
- 改写 `status`
- 改写 `output`
- 改写 `artifacts`
- 改写 `error`
- 改写 `metrics`
- 请求在 result 被接纳后暂停
- 请求在 result 被接纳后终止

限制：

- 修改后的 result 仍必须通过 core 校验。
- 如果 result 被 core 拒绝，则 hook 的暂停或终止请求不生效。
- 只要 result 被 core 接纳，暂停或终止请求就可以生效；不要求 accepted status 是 `success`。
- hook 不能选择 outcome 或 next step。
- hook 不能返回 `transition`、`state` 等状态机字段。

`afterStep` 返回值只允许包含 `result`、`control`。`result` patch 只允许包含 `status`、`output`、`artifacts`、`error`、`metrics`，不得包含 `outcome_id`、`next_step` 或其他状态机字段。Hook 收到的 `packet`、`definition`、`state` 和 `result` 也是隔离副本。

## 9. 执行时序

### 9.1 Agent 驱动模式

```text
agent -> startRun
agent -> getRunState / getCurrentStep
agent -> runReadyStep
runtime -> buildStepPacket
runtime -> beforeStep
runtime -> max_run_secs check
runtime -> executor registry dispatch
runtime -> max_run_secs check
runtime -> afterStep
runtime -> max_run_secs check
runtime -> applyStepResult
runtime -> step_result_accepted event
runtime -> max_run_secs check before hook control
agent -> inspect state/result
agent -> decideOutcome
runtime -> applyDecision
repeat until terminated
```

### 9.2 Retry

Retry 不是特殊 API。Retry 是预声明 outcome 的一种常见用法。

```json
{
  "transitions": {
    "retry": {"next_step": "same_step_id"}
  }
}
```

SDK 处理 retry 时必须校验：

- transition 指向当前 step。
- 当前 attempt 未超过 `retry_policy.max_attempts`。
- 当前 result status 在 `retry_policy.retry_on` 中，除非 SOP 作者有明确允许成功后重做的 outcome 语义。

### 9.3 Termination

终止来源有三类：

- SOP transition 终止
- Agent 调用 `terminateRun`
- hook 请求终止

所有终止都必须写入 run state 和 history。

## 10. StateStore 契约

v1-alpha 采用快照加索引模型。

### 10.1 必须保存

- `RunState` 最新快照
- `RunRecord` 索引

`RunRecord` 至少包含：

- `run_id`
- `sop_id`
- `sop_version`
- `idempotency_key`
- `concurrency_key`
- `created_at`
- `updated_at`
- `completed_at`

### 10.2 原子性要求

`claimRunStart` 必须是原子的。持久化实现不能先查再无条件写。

v1-alpha 不要求：

- step lease
- decision lease
- compare-and-swap state version
- 多 worker 同时推进同一 run

同一 run 在 v1-alpha 中只能由单 driver 推进。

## 11. 错误与拒绝模型

SDK 应使用稳定错误码区分：

- definition invalid
- run input invalid
- invalid state
- executor not registered
- step result rejected
- decision rejected
- hook rejected
- pause rejected
- resume rejected
- terminate rejected
- runtime policy rejected

原则：

- 非法状态迁移必须抛错或返回明确失败。
- executor 业务失败应进入 `StepResult.status`。
- SDK 自身契约失败应使用 typed error。
- 失败不能让 run 进入未定义状态。

## 12. v1-alpha 非目标

暂不实现：

- 多 worker lease / CAS
- 硬取消正在执行的 executor
- 条件自动路由
- 动态插入步骤
- 动态修改 definition
- 并行 fan-out / fan-in
- 子流程
- 补偿事务
- 事件源存储
- SDK 内置具体 LLM、shell、sandbox、软件工具实现

## 13. 当前实现迁移要求

为了从当前实现迁移到目标架构，优先顺序如下：

1. 调整 `definition` 中 executor DSL，从固定 `sandbox_tool` / `sandbox_script` / `sandbox_model` 改为通用 `kind + name + config`。—— 已完成
2. 更新 JSON Schema、validator、README 和测试。—— 已完成
3. 在 `RunState` 中加入 `paused` phase 与 pause metadata。—— 已完成
4. 在 core 中加入 pause、resume、manual terminate 的纯函数。—— 已完成
5. 在 runtime 中增加显式监管 API。—— 已完成
6. 在 runtime 中加入 executor registry，用 `kind + name` 分发。—— 已完成
7. 加入 `beforeStep` / `afterStep` hook 管线，并完成隔离、strict guard、deadline 优先级和事件语义收尾。—— 已完成
8. 将当前 `ToolRegistryExecutor` 降级为 example/reference adapter（保留公共导出用于兼容，不在本任务中移除）。—— 已完成
9. 用测试覆盖 SOP authoring、执行者注册、hook、pause/resume、retry、manual terminate。—— 已完成
10. 加入 `defineSop` Builder API，用类型化 authoring 降低手写 JSON definition 的成本。—— 已完成

## 14. 验收场景

实现完成后至少应满足：

- Agent 可以 start run、读取 state、执行当前 step、选择 outcome、retry、pause、resume、terminate。
- SOP 使用 `executor.kind + executor.name` 能正确分发到注册 handler。
- 未注册 executor 被明确拒绝。
- Executor 返回 `success` 但 output 不满足 `output_schema` 时，core 收敛为 `invalid_output`。
- Agent 选择未声明 outcome 时被拒绝。
- retry outcome 指回当前 step 时 attempt 增加，超过上限时被拒绝。
- paused run 不能继续执行 step 或 decision。
- resume 后恢复到暂停前 phase。
- beforeStep 可以改写 packet，afterStep 可以改写 result。
- hook 改写后的 packet/result 仍被 core 和 validator 校验。
- hook、executor、agent 都不能绕过预声明 transition。
- `bun run check` 通过。
