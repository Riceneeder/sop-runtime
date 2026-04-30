# `@sop-runtime/runtime`

`@sop-runtime/runtime` 是 SOP 执行系统里的可嵌入运行层。它把 `@sop-runtime/core` 的纯状态机能力和外部端口组合起来，负责启动 run、执行当前步骤、接收监督决策、持久化状态，并在终止时渲染最终输出。

## 什么时候读

当你准备把已校验的 SOP definition 接到实际执行环境时，读这个包。这里的重点是 `RuntimeHost` 和端口契约；若只是想理解 definition 长什么样，先看[根 README](../../README.md) 和 [`examples/basic_sop_definition.json`](../../examples/basic_sop_definition.json)。

## 包定位

这个包位于依赖链的最外层：

```text
definition -> validator -> core -> runtime
```

它负责：

- 通过 `RuntimeHost` 编排一次 SOP run 的生命周期。
- 定义运行层端口：`StateStore`、`StepExecutor`、`DecisionProvider`、`Clock`、`IdGenerator`、`RuntimeLogger`、`EventSink`。
- 提供本地默认实现：`InMemoryStateStore`、`DefaultDecisionProvider`、`SystemClock`、`RandomIdGenerator`、noop logger / event sink。
- 执行 host 级策略：idempotency、concurrency、cooldown、`max_run_secs`、事件发射、最终输出渲染。

它不负责：

- 校验 SOP definition 是否可以准入；准入校验仍在 `@sop-runtime/validator`。
- 直接调用 shell、LLM、浏览器、MCP 或沙箱；这些能力由 `StepExecutor` 适配。
- 提供分布式调度、队列、租约或多租户 server 能力。
- 在 executor / decision provider 运行中强制中断任务；runtime 只会在调用返回后阻止过期状态被错误持久化。

## 对外暴露内容

公共入口是 [`src/index.ts`](./src/index.ts)，主要导出：

- `RuntimeHost`：运行层主入口。
- `InMemoryStateStore`：单进程内存 store，适合测试、demo 和轻量嵌入。
- `DefaultDecisionProvider`：选择当前步骤 `default_outcome` 的默认决策器。
- `StateStore`、`StepExecutor`、`DecisionProvider`：外部集成需要实现的核心端口。
- `RuntimeEvent`、`EventSink`、`RuntimeLogger`：审计和观测相关端口。
- `RuntimeError`、`RuntimeErrorCode`：运行层错误。
- `CoreError`：从 core 包透传，便于调用方统一捕获。

典型导入方式：

```ts
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
  StepExecutor,
} from '@sop-runtime/runtime';
```

## 最小使用示例

```ts
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
  StepExecutor,
} from '@sop-runtime/runtime';

const executor: StepExecutor = {
  async execute(packet) {
    return {
      'run_id': packet.run_id,
      'step_id': packet.step_id,
      'attempt': packet.attempt,
      'status': 'success',
      'output': {'summary': 'done'},
      'artifacts': {},
    };
  },
};

const host = new RuntimeHost({
  'store': new InMemoryStateStore(),
  executor,
  'decisionProvider': new DefaultDecisionProvider(),
});

const started = await host.startRun({
  definition,
  'input': {'company': 'Acme'},
});

const completed = await host.runUntilComplete({
  definition,
  'runId': started.state.run_id,
});

console.log(completed.state.status);
console.log(completed.final_output);
```


## ToolRegistryExecutor

`ToolRegistryExecutor` 是 runtime 内置的轻量执行器，专门用于 `sandbox_tool` 步骤。

- 通过构造函数注册工具处理器（tool handlers），由宿主应用提供具体工具能力。
- 对 `sandbox_script` 与 `sandbox_model` 会返回结构化 `tool_error`，当前刻意不支持。
- 适用于本地嵌入、测试、demo，以及由宿主应用已控制工具能力的早期生产集成。

## RuntimeHost 生命周期

`RuntimeHost` 暴露三个主要方法：

- `startRun(params)`：根据 definition 和 input 创建或复用 run。
- `runReadyStep(params)`：当 run 处于 `ready` 阶段时，构建 `StepPacket` 并调用 `StepExecutor`。
- `applyDecision(params)`：当 run 处于 `awaiting_decision` 阶段时，应用外部传入或 `DecisionProvider` 生成的 `Decision`。
- `runUntilComplete(params)`：循环调用上面两个动作，直到 run 进入 `terminated`。

主流程如下：

```text
startRun
  -> createRun(core)
  -> render idempotency/concurrency keys
  -> StateStore.claimRunStart
  -> ready

runReadyStep
  -> buildStepPacket(core)
  -> StepExecutor.execute
  -> applyStepResult(core)
  -> awaiting_decision

applyDecision
  -> DecisionProvider.decide or caller decision
  -> applyDecision(core)
  -> ready or terminated
```

当 run 以 `succeeded` 终止时，`runUntilComplete` 会调用 core 的 `renderFinalOutput` 并返回 `final_output`。

## 启动策略语义

`startRun` 会先创建候选 `RunState` 和 `RunRecord`，再交给 `StateStore.claimRunStart` 做原子认领。返回的 `reason` 表示这次请求如何被处理：

- `created`：创建了新 run。
- `idempotent_replay`：同一 SOP 身份、版本和 idempotency key 已有 run，直接复用。
- `singleflight_joined`：同一 concurrency key 已有运行中 run，按 `singleflight` 复用运行中 run。
- `dropped_running`：同一 concurrency key 已有运行中 run，按 `drop_if_running` 返回运行中 run。
- `cooldown_active`：同一 concurrency key 最近完成的 run 仍在 cooldown 窗口内，返回最近完成 run。

`StateStore.claimRunStart` 必须是原子的。持久化实现不能先查再无条件写，否则并发启动会破坏 idempotency / singleflight / cooldown 语义。`InMemoryStateStore` 只保证单进程内的同步临界区，不提供跨进程或跨机器锁。

## 超时与定义身份

RuntimeHost 在执行动作前会检查：

- 传入 definition 的 `sop_id` 必须匹配持久化 run 的 `sop_id`。
- 传入 definition 的 `version` 必须匹配持久化 run 的 `sop_version`。
- 非终止 run 如果超过 `definition.policies.max_run_secs`，会被保存为 `failed / terminated`，终止原因是 `max_run_secs_exceeded`。

`runReadyStep` 和 `applyDecision` 在外部调用返回后会再次检查 `max_run_secs`。这样 executor 或 decision provider 即使跨过 deadline，也不会把过期 run 保存成 `awaiting_decision` 或成功终止。

## 并发边界

当前 runtime MVP 已处理启动阶段并发：`claimRunStart` 要求 store 原子处理 run id、idempotency key、concurrency key 和 cooldown。

当前 runtime MVP 还没有实现 step / decision 阶段的租约或 CAS：

- 不应让多个 worker 同时对同一个 run 调用 `runReadyStep`。
- 不应让多个 worker 同时对同一个 run 调用 `applyDecision`。
- 如果未来需要多 worker 驱动同一 run，应扩展 `StateStore`，加入 step claim、decision claim、version check 或 lease token。

## 事件与观测

如果传入 `EventSink`，RuntimeHost 会发出以下事件：

- `run_started`
- `run_reused`
- `step_packet_built`
- `step_result_accepted`
- `decision_applied`
- `run_terminated`

事件用于审计和集成层观测，不参与 core 状态机判定。事件 sink 失败会让当前 host 调用失败，因此生产环境实现应自行决定是否吞掉下游观测系统异常。

## 文件清单与职责

### 源码与配置文件

| 文件 | 作用 |
| --- | --- |
| [`package.json`](./package.json) | 定义包名、导出入口和对 core / definition 的 workspace 依赖。 |
| [`tsconfig.json`](./tsconfig.json) | 指定 runtime 的构建输入输出，并引用上游包。 |
| [`src/index.ts`](./src/index.ts) | 公共导出入口。 |
| [`src/runtime_host.ts`](./src/runtime_host.ts) | host 编排主逻辑，串联 core 和各运行端口。 |
| [`src/state_store.ts`](./src/state_store.ts) | 持久化端口和 run record / start claim 契约。 |
| [`src/in_memory_state_store.ts`](./src/in_memory_state_store.ts) | 单进程内存 store 实现。 |
| [`src/step_executor.ts`](./src/step_executor.ts) | 执行端口，适配 shell、沙箱、工具或 Agent。 |
| [`src/decision_provider.ts`](./src/decision_provider.ts) | 监督决策端口和默认决策实现。 |
| [`src/clock.ts`](./src/clock.ts) | 可注入时钟端口。 |
| [`src/id_generator.ts`](./src/id_generator.ts) | 可注入 run id 生成端口。 |
| [`src/event_sink.ts`](./src/event_sink.ts) | 运行事件端口。 |
| [`src/logger.ts`](./src/logger.ts) | 结构化日志端口。 |
| [`src/runtime_error.ts`](./src/runtime_error.ts) | 运行层错误码和错误类。 |

### 测试文件

| 文件 | 作用 |
| --- | --- |
| [`src/index.test.ts`](./src/index.test.ts) | 验证公共入口导出核心端口和类型。 |
| [`src/runtime_host.test.ts`](./src/runtime_host.test.ts) | 覆盖 host 主流程、启动策略、超时、终止事件、错误分支。 |

## 推荐阅读顺序

### 如果你是包使用者

1. [`src/index.ts`](./src/index.ts)
2. 本 README 的“最小使用示例”
3. [`src/step_executor.ts`](./src/step_executor.ts)
4. [`src/runtime_host.ts`](./src/runtime_host.ts)
5. [`src/runtime_host.test.ts`](./src/runtime_host.test.ts)

### 如果你要实现自定义 store

1. [`src/state_store.ts`](./src/state_store.ts)
2. [`src/in_memory_state_store.ts`](./src/in_memory_state_store.ts)
3. `runtime_host.test.ts` 中与 idempotency、singleflight、drop、cooldown、run id 冲突相关的测试

重点是 `claimRunStart`，不是单独的 `loadRun` / `saveRun`。真实持久化 store 应该把它实现为数据库事务、唯一索引加条件写，或等价的原子操作。

## 验证命令

推荐在修改 runtime 后至少运行：

```sh
bun test packages/runtime/src
bun run check
```

如果改了导出、构建产物或 package metadata，再补充：

```sh
npm_config_cache=/tmp/sop-runtime-npm-cache npm pack --dry-run --json ./packages/runtime
node -e "import('./packages/runtime/dist/index.js').then(() => console.log('ok'))"
```
