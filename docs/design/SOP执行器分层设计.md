# SOP 执行器分层设计

> 创建时间：2026-04-16
> 状态：第一版草案

---

## 目标

做一个**解耦、可嵌入、可预测**的 SOP 执行器内核，作为以下形态的共同基础：

- CLI 工具
- MCP 服务
- 各类 Agent 框架插件
- 各类沙箱执行环境适配层

这个执行器的目标不是做重型 workflow server，而是做一个稳定的**SOP runtime foundation**。

---

## 核心原则

1. **Core 不感知 Agent SDK**
   不依赖 OpenAI Agents、LangGraph、AutoGen、CrewAI 或任何特定框架的数据结构和生命周期。
2. **Core 不感知 Sandbox**
   不依赖 SkillLite、E2B、Modal、本地 shell、Docker 或任意具体执行环境。
3. **Core 不感知存储**
   不直接绑定 SQLite、文件、Redis、Postgres 或任何持久化方案。
4. **SOP 是声明式流程**
   所有可走路径、可重试路径、终止路径都必须预声明。
5. **状态迁移必须可预测**
   同一份 definition、同一份 state、同一份输入，必须得到同样的结果。
6. **集成层全部下沉到 adapter/driver**
   框架差异、SDK 差异、沙箱差异都通过接口隔离。

---

## 总体分层

建议从内到外分成 6 层。

| 层级 | 名称 | 负责 | 不负责 |
| --- | --- | --- | --- |
| 1 | Definition Layer | 定义 SOP DSL、类型模型、标准对象结构 | 不做执行、不做外部集成 |
| 2 | Validation Layer | 校验 SOP definition 的结构与语义合法性 | 不做状态推进、不做实际执行 |
| 3 | Core Engine Layer | 做纯状态机推进、输入渲染、输出收敛、合法性判定 | 不调用 Agent、不调沙箱、不落盘 |
| 4 | Runtime Ports Layer | 定义 store / executor / decision / clock / logger 等接口 | 不绑定具体实现 |
| 5 | Host Runtime Layer | 把 core 和外部端口组装起来，形成可运行流程 | 不把自己做成大而全 server |
| 6 | Adapter / Driver Layer | 对接 CLI、MCP、Agent 框架、Sandbox、存储实现 | 不修改 core 语义 |

---

## 第 1 层：Definition Layer

这一层负责定义统一的数据模型，是整个系统的协议基础。

### 负责内容

- `SopDefinition`
- `StepDefinition`
- `ExecutorConfig`
- `RetryPolicy`
- `SupervisionConfig`
- `Transition`
- `RunState`
- `StepRun`
- `StepPacket`
- `StepResult`
- `Decision`
- `FinalOutput`

### 这一层的价值

- 给所有上层提供统一类型边界
- 让 CLI、MCP、框架插件共享同一套对象语义
- 防止每个 adapter 自己发明一套字段

### 不负责的事

- 不校验 definition 是否正确
- 不推进 run 状态
- 不做 IO
- 不依赖任何外部 SDK

---

## 第 2 层：Validation Layer

这一层专门负责“这份 SOP definition 能不能被接受”。

建议拆成三类校验器。

### 2.1 Schema Validator

负责静态结构校验，例如：

- 必填字段是否存在
- 字段类型是否正确
- `executor.kind` 与条件字段是否匹配
- `retry_policy`、`transitions`、`supervision` 是否满足基本结构

### 2.2 Semantic Validator

负责跨字段、跨步骤的语义校验，例如：

- `entry_step` 是否存在
- `step.id` 是否唯一
- `allowed_outcomes` 和 `transitions` 是否一一对应
- `next_step` 是否指向存在的步骤
- `default_outcome` 是否存在于允许结果中

### 2.3 Expression Validator

负责校验表达式是否可解析、可引用，例如：

- `${run.input.xxx}` 是否是合法路径
- `${steps.xxx.output.xxx}` 是否引用了已知步骤
- `coalesce(...)` 语法是否合法
- `final_output` 中引用的字段是否理论可达

### 不负责的事

- 不执行步骤
- 不访问沙箱
- 不向 Agent 请求决策
- 不处理运行时 attempt 计数

---

## 第 3 层：Core Engine Layer

这一层是整个系统最核心的部分，也是最应该保持纯净的部分。

它的定位是：

**一个纯、确定性的 SOP 状态机引擎。**

### 负责内容

- 根据 `SopDefinition + RunState` 计算当前可执行步骤
- 渲染当前步骤输入
- 组装 `StepPacket`
- 接收 `StepResult`
- 校验 `StepResult` 是否满足当前步骤约束
- 根据外部传入的 `Decision` 执行状态迁移
- 校验 outcome 是否合法、是否超出重试上限
- 生成下一状态
- 在 run 终止时渲染 `final_output`

### 推荐暴露的核心接口

- `validateDefinition(definition)`
- `createRun(definition, runInput)`
- `getCurrentStep(runState)`
- `buildStepPacket(definition, runState)`
- `applyStepResult(definition, runState, stepResult)`
- `applyDecision(definition, runState, decision)`
- `renderFinalOutput(definition, runState)`

### 关键约束

- 输入输出尽量都是 plain JSON object
- 同一输入必须得到同一状态迁移结果
- 不允许内部偷偷读文件、读数据库、读环境变量

### 不负责的事

- 不决定调用哪个 LLM
- 不决定调用哪个 Agent SDK
- 不直接执行 shell、tool、model
- 不保存 run state
- 不输出面向特定框架的消息对象

---

## 第 4 层：Runtime Ports Layer

这一层只定义“外部能力接口”，不提供具体实现。

它的作用是把 core 和外部世界隔离开。

### 建议端口

- `StateStore`
  - 保存和读取 `RunState`
  - 保存 `RunRecord`
  - 原子处理 run 启动认领、幂等、并发和 cooldown 策略
- `StepExecutor`
  - 接收 `StepPacket`
  - 返回 `StepResult`
- `DecisionProvider`
  - 基于当前上下文返回 `Decision`
  - 可以由 Agent、规则引擎或人工输入实现
- `Clock`
  - 提供时间，避免 core 直接依赖系统时钟
- `IdGenerator`
  - 生成 `run_id`、`trace_id`
- `Logger` / `EventSink`
  - 记录审计事件与调试信息

### 当前 MVP 对应实现

当前仓库中，Runtime Ports Layer 已落到 `packages/runtime/src`：

- `state_store.ts` 定义 `StateStore`、`RunRecord` 和 `claimRunStart` 契约
- `step_executor.ts` 定义 `StepExecutor`
- `decision_provider.ts` 定义 `DecisionProvider` 和默认决策器
- `clock.ts` 定义 `Clock`
- `id_generator.ts` 定义 `IdGenerator`
- `logger.ts` 与 `event_sink.ts` 定义观测端口

当前 `StateStore` 的重点不是单个 `saveRun`，而是 `claimRunStart` 必须具备原子性。真实数据库实现应通过事务、唯一索引或条件写实现同等语义。

### 这一层的价值

- 让同一个 runtime 可以挂不同 store
- 让同一个 runtime 可以接不同 executor
- 让“Agent 决策”和“规则决策”保持同一接口

### 不负责的事

- 不包含具体 SDK 调用逻辑
- 不包含 SQLite / MCP / OpenAI Agents 的实现细节

---

## 第 5 层：Host Runtime Layer

这一层是“可运行组装层”。

它不是纯 core，但也不是重型 server。它的职责是把 core 和外部端口串起来，形成一个真正能跑的执行流程。

### 负责内容

- 加载 definition
- 调用 validator 做准入校验
- 初始化 run state
- 通过 `StateStore` 保存快照
- 从 core 获取当前步骤
- 调用 `StepExecutor` 执行步骤
- 把 `StepResult` 交回 core 校验
- 调用 `DecisionProvider` 获取下一步 outcome
- 循环推进直到终止
- 输出最终结果和审计事件

### 这一层应该保持克制

- 不做平台化 server 能力
- 不强行引入多租户、任务队列、分布式调度
- 不假设必须长期驻留

### 适合承担的形式

- 一个 embeddable runtime class
- 一个 library API
- 一个可以被 CLI / MCP / 插件直接调用的 orchestration facade

### 当前 MVP 对应实现

当前 Host Runtime Layer 已落到 `packages/runtime/src/runtime_host.ts`。`RuntimeHost` 负责：

- 启动 run 并调用 `StateStore.claimRunStart`
- 根据 core 构建 `StepPacket`
- 调用 `StepExecutor`
- 将 `StepResult` 交回 core 收敛为新状态
- 调用 `DecisionProvider` 或应用调用方传入的 `Decision`
- 执行 `max_run_secs`、definition 身份匹配和终止事件发射
- 在成功终止后渲染 `final_output`

当前 MVP 不包含 step / decision 阶段的分布式租约或 CAS，因此同一个 run 不应被多个 worker 并发驱动。需要多 worker 执行时，应先扩展 `StateStore` 端口。

---

## 第 6 层：Adapter / Driver Layer

这一层负责把不同生态接到统一 runtime 上。

### 6.1 Host Adapters

负责暴露不同宿主入口。

- `CLI Adapter`
  - 命令行启动 run
  - 查看状态
  - 回放和调试
- `MCP Adapter`
  - 暴露 SOP 相关 tool / resource / task
  - 让外部 Agent 通过 MCP 调用 runtime
- `Framework Adapters`
  - 对接 OpenAI Agents
  - 对接 LangGraph
  - 对接其他 Agent 框架

### 6.2 Executor Drivers

负责执行具体步骤。

- 本地 shell driver
- SkillLite driver
- Docker / sandbox driver
- model invocation driver
- HTTP tool driver

### 6.3 Decision Drivers

负责提供决策来源。

- LLM-based decision driver
- rule-based decision driver
- human-in-the-loop decision driver

### 6.4 Store Drivers

负责 run state 的落盘实现。

- memory store
- file store
- sqlite store
- redis store

### 这一层的约束

- 只能实现接口，不能反向污染 core
- 框架专属字段必须止步于 adapter
- SDK 升级不能要求 core 改语义

---

## 推荐的包边界

如果用 TypeScript 实现，建议拆成下面这些包：

- `packages/definition`
- `packages/validator`
- `packages/core`
- `packages/runtime`
- `packages/adapter-cli`
- `packages/adapter-mcp`
- `packages/store-memory`
- `packages/store-sqlite`
- `packages/executor-local-shell`
- `packages/executor-sandbox`
- `packages/decision-llm`
- `packages/decision-rules`
- `packages/adapter-openai-agents`
- `packages/adapter-langgraph`

其中最重要的边界是：

- `definition + validator + core` 不依赖任何具体框架
- `runtime` 只依赖接口，不依赖具体 SDK
- 所有生态耦合都留在 `adapter-*` 和 `driver-*`

---

## 一条推荐的依赖方向

依赖应该只允许从外向内。

```text
adapter-* / driver-*
        ↓
      runtime
        ↓
       core
        ↓
    validator
        ↓
    definition
```

禁止反向依赖：

- `core` 不能 import `adapter-*`
- `core` 不能 import `store-*`
- `validator` 不能依赖 `runtime`
- `definition` 不能依赖其他层

---

## 最小可用版本建议

第一阶段只做下面 4 层就够了：

1. `definition`
2. `validator`
3. `core`
4. `adapter-cli`

其中：

- `runtime` 先做很薄的一层即可
- `store` 先用 `memory` 或 `sqlite`
- `decision provider` 先用人工决策或简单规则
- `executor` 先接一个最小本地执行器

这样可以先验证：

- SOP DSL 是否足够表达
- validator 是否能挡住非法 definition
- core 的状态推进是否稳定
- adapter 边界是否真的解耦

---

## 当前结论

对这个项目，最关键的不是“选哪个 Agent SDK”，而是先守住这条边界：

**SOP 执行语义归 core，生态集成差异归 adapter/driver。**

只要这条边界不破，后面无论接 CLI、MCP 还是任何 Agent 框架，都会轻很多。
