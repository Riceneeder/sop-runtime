# SOP 执行器 Core 设计

> 创建时间：2026-04-16
> 状态：第一版草案
> 关联文档：[SOP执行器分层设计.md](./SOP执行器分层设计.md)

---

## 1. 定位

`core` 是整个 SOP 执行器里最内层、最稳定的一层。

它的职责不是“把流程跑起来”，而是：

- 定义 SOP 执行的**确定性语义**
- 维护 run 的**状态机**
- 在纯输入下计算：
  - 当前该执行哪个步骤
  - 当前步骤需要什么输入
  - 某个步骤结果是否合法
  - 某个决策是否合法
  - 下一状态应该是什么

一句话：

**`core` 是一个纯、可预测、无外部依赖的 SOP 状态机引擎。**

---

## 2. 设计目标

### 2.1 必须满足

1. **纯**
   不直接读文件、数据库、环境变量、网络。
2. **确定性**
   同一份 `definition + state + input` 必须得到同一份结果。
3. **声明式**
   只允许走 `SOP Definition` 里预声明的路径。
4. **可嵌入**
   能被 CLI、MCP、Agent 框架、规则系统直接复用。
5. **可测试**
   可以只靠 JSON fixture 做单测和回放。
6. **可审计**
   每次状态迁移都能解释为什么发生。

### 2.2 明确不做

1. 不调用任何 Agent SDK
2. 不调用任何 Sandbox
3. 不实现持久化
4. 不实现任务队列或 server 生命周期
5. 不生成框架专属消息对象
6. 不负责权限申请、沙箱鉴权、文件布局

---

## 3. Core 的边界

### 3.1 上游输入

`core` 只接受这几类输入：

- `SopDefinition`
- `RunState`
- `runInput`
- `ExecutorResult`
- `Decision`
- 运行时显式传入的 `now`、`runId` 等确定性参数

### 3.2 下游输出

`core` 只产出这几类输出：

- `ValidationReport`
- `RunState`
- `CurrentStepView`
- `CoreStepPacket`
- `CoreTransition`
- `FinalOutput`
- `CoreError`

### 3.3 不进入 Core 的内容

下面这些字段即使在整体系统中存在，也不应该进 `core`：

- OpenAI / LangGraph / AutoGen 的消息对象
- MCP request / response envelope
- CLI 参数解析对象
- `trace_id`
- `artifacts_dir`
- 宿主的 logger 实例
- Sandbox 的 session id
- 数据库连接
- 文件路径布局策略

这些都属于 `runtime` 或 `adapter` 的责任。

---

## 4. Core 负责什么

### 4.1 Definition 准入

`core` 负责调用 validator，对 `SopDefinition` 做准入校验：

- 结构是否合法
- 语义是否合法
- 表达式是否可解析

### 4.2 Run 初始化

`core` 负责把一份合法 definition 和一份 run input 变成初始 `RunState`：

- 绑定 `run_id`
- 记录 `sop_id`、`version`
- 合并默认值和输入
- 初始化步骤状态
- 定位 `entry_step`

### 4.3 当前步骤求值

`core` 负责根据当前状态判断：

- run 是否已终止
- 当前是否存在 active step
- 当前步骤是哪个
- 当前 attempt 是多少
- 当前是否允许构建 step packet

### 4.4 输入渲染

`core` 负责：

- 解析 `${run.input.xxx}`
- 解析 `${steps.xxx.output.xxx}`
- 解析 `${steps.xxx.artifacts.xxx}`
- 解析 `${coalesce(...)}`
- 生成当前步骤的最终输入对象

### 4.5 Step Result 接纳

`core` 负责校验一份 `ExecutorResult` 能否被接受：

- 是否属于当前 active step
- `attempt` 是否匹配
- 返回字段是否合法
- 输出是否满足当前步骤的 `output_schema`
- 若输出不合法，是否应归类为 `invalid_output`

### 4.6 Decision 接纳

`core` 负责校验一份 `Decision` 能否被接受：

- 是否针对当前等待决策的步骤
- `outcome_id` 是否在允许集合中
- 如果是重试，是否超出最大尝试次数
- 对应 transition 是否存在

### 4.7 状态迁移

`core` 负责生成下一状态：

- 保留审计所需的最小历史
- 更新当前步骤状态
- 跳转到下一步骤
- 或进入终止状态

### 4.8 Final Output 渲染

run 终止后，`core` 负责根据 `final_output` 表达式渲染最终结果。

---

## 5. Core 不负责什么

为了避免边界漂移，下面这些事必须明确留在 `runtime` 或 `adapter`：

### 5.1 具体执行

- 不执行 shell
- 不调用 model
- 不调 tool
- 不开子进程
- 不管理超时

### 5.2 决策来源

- 不提示 LLM
- 不请求人类确认
- 不运行规则引擎

`core` 只消费已经形成的 `Decision`。

### 5.3 存储与恢复

- 不保存状态快照
- 不加载历史 run
- 不处理数据库并发
- 不处理锁

### 5.4 审计落盘

`core` 可以产出最小历史字段，但不负责写日志系统。

### 5.5 宿主协议

- 不暴露 CLI 命令
- 不暴露 MCP tools/resources/tasks
- 不暴露框架插件接口

---

## 6. Core 的核心设计原则

### 6.1 单一活跃步骤

任意时刻，一个 run 只能有一个 active step。

这意味着第一版 `core` 不负责并行 fan-out / fan-in。后续如果需要并行，也应该在 definition 和 state model 上显式扩展，而不是偷偷把数组塞进去。

### 6.2 事实和决策分离

执行器只提供**事实**，监督者只提供**决策**。

- `ExecutorResult` 只描述执行发生了什么
- `Decision` 只描述选择了哪个 outcome

两者都不能直接指定下一步是什么。

### 6.3 Transition 只能来自 Definition

真正的路由关系只来自 `definition.steps[n].transitions`。

这意味着：

- 执行器不能说“请去 step_b”
- 决策者不能说“直接跳 step_c”
- 宿主不能绕过 transition table

### 6.4 输出先收敛，再暴露

步骤执行结束后，只有被 `core` 接纳的输出才能进入共享上下文。

也就是说：

- 结构错误的输出不能被后续步骤引用
- 非当前步骤的结果不能污染 run state
- 未被接受的 artifacts 不能进入 `steps.xxx.artifacts`

### 6.5 包络信息不上 Core

与 transport 或宿主相关的信息不放进核心对象，例如：

- trace
- transport metadata
- sandbox session
- CLI flags

否则 `core` 会很快被外围协议污染。

---

## 7. Core 数据模型

这一节只定义 `core` 真正需要持有的对象。

---

## 7.1 RunState

`RunState` 是 `core` 的中心对象。它必须足够表达状态推进，但不能把宿主数据全部塞进来。

建议结构如下：

```ts
type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

type RunPhase =
  | "ready"
  | "awaiting_decision"
  | "terminated";

type RunState = {
  run_id: string;
  sop_id: string;
  sop_version: string;

  status: RunStatus;
  phase: RunPhase;

  run_input: JsonObject;

  entry_step_id: string;
  current_step_id: string | null;
  current_attempt: number | null;

  steps: Record<string, StepState>;

  accepted_results: Record<string, AcceptedStepResult | undefined>;

  history: HistoryEntry[];

  terminal?: {
    run_status: "succeeded" | "failed" | "cancelled";
    reason: string;
  };

  created_at?: string;
  updated_at?: string;
};
```

### 字段说明

- `status`
  - run 的最终状态视图
- `phase`
  - run 当前处于哪个状态机阶段
- `current_step_id`
  - 当前活跃步骤
- `current_attempt`
  - 当前步骤的 attempt，从 `1` 开始
- `steps`
  - 每个步骤自己的运行态
- `accepted_results`
  - 每个步骤被接纳后的最终可引用结果
- `history`
  - 最小审计历史，支持回放和解释

### 为什么不把所有 StepRun 全量塞进 RunState

可以塞，但第一版不建议。

原因：

- `core` 只需要“足以推进状态”的历史
- 完整审计明细更适合落在 `runtime store`
- 否则 `RunState` 很快会膨胀成 transport + audit + debugging 的大对象

如果后续需要完整回放，可以在 `runtime` 层保存完整事件日志。

---

## 7.2 StepState

```ts
type StepLifecycle =
  | "pending"
  | "active"
  | "waiting_decision"
  | "completed"
  | "failed";

type StepState = {
  step_id: string;
  status: StepLifecycle;
  attempt_count: number;
  last_result_status?:
    | "success"
    | "timeout"
    | "tool_error"
    | "sandbox_error"
    | "invalid_output";
  last_outcome_id?: string;
};
```

### 设计意图

- `attempt_count` 用来限制重试
- `last_result_status` 用来给 decision provider 或宿主解释当前处境
- `last_outcome_id` 用来追踪本步骤最后一次被选中的 transition

---

## 7.3 AcceptedStepResult

`AcceptedStepResult` 代表已经被 `core` 接纳、允许后续步骤引用的结果。

```ts
type AcceptedStepResult = {
  step_id: string;
  attempt: number;
  status:
    | "success"
    | "timeout"
    | "tool_error"
    | "sandbox_error"
    | "invalid_output";
  output?: JsonObject;
  artifacts?: Record<string, string>;
  error?: {
    code: string;
    message: string;
    details?: JsonObject;
  } | null;
  metrics?: JsonObject;
};
```

### 关键规则

- 只有被 `core` 接纳后，结果才会进入这里
- `status = success` 时，`output` 必须满足 `output_schema`
- 如果执行器返回成功但 `output_schema` 不匹配，`core` 应把状态规范化为 `invalid_output`

---

## 7.4 CoreStepPacket

这不是最终 transport packet，而是 `core` 产出的**执行意图对象**。

```ts
type CoreStepPacket = {
  run_id: string;
  step_id: string;
  attempt: number;
  inputs: JsonObject;
  executor: ExecutorConfig;
  output_schema: JsonObject;
};
```

### 为什么不直接沿用系统总设计里的 Step Packet

因为总设计里的 Step Packet 还包含：

- `trace_id`
- `artifacts_dir`
- 宿主相关追踪字段

这些都不是 `core` 该决定的。

更合适的做法是：

- `core` 产出 `CoreStepPacket`
- `runtime` 在外面再包装成 `RuntimeStepEnvelope`

---

## 7.5 ExecutorResult

`ExecutorResult` 是执行器回传给 `core` 的事实对象。

```ts
type ExecutorResult = {
  run_id: string;
  step_id: string;
  attempt: number;

  status: "success" | "timeout" | "tool_error" | "sandbox_error";

  output?: JsonObject;
  artifacts?: Record<string, string>;
  error?: {
    code: string;
    message: string;
    details?: JsonObject;
  } | null;
  metrics?: JsonObject;
};
```

### 关键约束

- 执行器只能返回事实
- 执行器不能返回建议性字段，例如：
  - `suggested_outcome`
  - `next_step`
  - `should_retry`

这些都必须被拒绝或忽略。

---

## 7.6 Decision

`Decision` 是外部监督者交给 `core` 的唯一决策对象。

```ts
type Decision = {
  run_id: string;
  step_id: string;
  attempt: number;
  outcome_id: string;
  reason?: string;
  metadata?: JsonObject;
};
```

### 关键约束

- 只能选 `outcome_id`
- 不能直接指定 `next_step`
- 不能修改重试次数
- 不能越过 transition table

---

## 7.7 HistoryEntry

建议 `core` 只保留最小事件历史。

```ts
type HistoryEntry =
  | {
      kind: "run_created";
      at?: string;
      step_id: string;
    }
  | {
      kind: "step_result_accepted";
      at?: string;
      step_id: string;
      attempt: number;
      result_status: string;
    }
  | {
      kind: "decision_applied";
      at?: string;
      step_id: string;
      attempt: number;
      outcome_id: string;
    }
  | {
      kind: "run_terminated";
      at?: string;
      run_status: string;
      reason: string;
    };
```

这个集合不要无限扩张。详细调试日志放 `runtime`。

---

## 8. Core 状态机

`core` 的 run 级状态机建议如下：

```text
createRun
  -> ready
  -> awaiting_decision
  -> ready
  -> ...
  -> terminated
```

更准确地说：

### 8.1 `ready`

含义：

- 当前有一个 active step
- 可以构建 `CoreStepPacket`
- 还没有接纳当前 attempt 的结果

### 8.2 `awaiting_decision`

含义：

- 当前步骤的一份结果已经被接纳
- `core` 正等待外部传入 `Decision`

此时：

- 不能再次接纳新的 `ExecutorResult`
- 不能构建新的 packet
- 只能调用 `applyDecision()`

### 8.3 `terminated`

含义：

- run 已经结束
- 不再接受新的 result 或 decision
- 可以调用 `renderFinalOutput()`

---

## 9. Core API 设计

推荐使用“外部 facade + 内部 reducer 思想”的 hybrid 设计。

---

## 9.1 `validateDefinition`

```ts
function validateDefinition(
  definition: SopDefinition
): ValidationReport;
```

### 负责

- 调 schema validator
- 调 semantic validator
- 调 expression validator

### 返回

- `ok = true` 时可准入
- `ok = false` 时给出 diagnostics 列表

---

## 9.2 `createRun`

```ts
function createRun(params: {
  definition: SopDefinition;
  input: JsonObject;
  runId: string;
  now?: string;
}): RunState;
```

### 行为

1. 校验 definition 已合法
2. 校验 run input 是否满足 `input_schema`
3. 合并 `defaults`
4. 初始化 `RunState`
5. 将 `entry_step` 设为当前步骤
6. 将 `current_attempt` 设为 `1`
7. 状态进入 `ready`

### 说明

- `runId` 由外部传入，不由 `core` 自行生成
- `now` 由外部传入，避免依赖系统时钟

---

## 9.3 `getCurrentStep`

```ts
function getCurrentStep(params: {
  definition: SopDefinition;
  state: RunState;
}): CurrentStepView | null;
```

### 返回内容

```ts
type CurrentStepView = {
  step_id: string;
  attempt: number;
  step: StepDefinition;
  step_state: StepState;
};
```

### 规则

- `terminated` 返回 `null`
- `awaiting_decision` 返回当前 step 视图也可以，但不允许 `buildStepPacket`

---

## 9.4 `buildStepPacket`

```ts
function buildStepPacket(params: {
  definition: SopDefinition;
  state: RunState;
}): CoreStepPacket;
```

### 行为

1. 读取当前 step
2. 解析 `inputs` 表达式
3. 取出 `executor`
4. 取出 `output_schema`
5. 产出 `CoreStepPacket`

### 规则

- 只允许在 `phase = ready` 时调用
- 调用多次必须得到同样结果
- 不改变 `RunState`

---

## 9.5 `applyStepResult`

```ts
function applyStepResult(params: {
  definition: SopDefinition;
  state: RunState;
  stepResult: ExecutorResult;
  now?: string;
}): RunState;
```

### 行为

1. 校验 run 是否仍处于可接纳结果状态
2. 校验 `step_id` 和 `attempt` 是否匹配当前活跃步骤
3. 校验 result 字段形状是否合法
4. 若 `status = success`，校验 `output_schema`
5. 若 output 不合法，把结果规范化为 `invalid_output`
6. 把规范化后的结果写入 `accepted_results`
7. 更新当前 `StepState`
8. 将 run 置为 `awaiting_decision`

### 重要说明

这一步只接纳事实，不做路由。

也就是说：

- `applyStepResult()` 之后不会自动跳下一步
- 是否重试、是否降级、是否终止，都要等 `Decision`

---

## 9.6 `applyDecision`

```ts
function applyDecision(params: {
  definition: SopDefinition;
  state: RunState;
  decision: Decision;
  now?: string;
}): RunState;
```

### 行为

1. 校验当前处于 `awaiting_decision`
2. 校验 `step_id`、`attempt` 是否匹配
3. 校验 `outcome_id` 是否在 `allowed_outcomes`
4. 校验 transition 是否存在
5. 若 outcome 代表重试，校验 `attempt < max_attempts`
6. 若 transition 指向 `next_step`
   - 切换 `current_step_id`
   - 若下一步就是自己，attempt `+1`
   - 若是新步骤，attempt 设为 `1`
   - phase 回到 `ready`
7. 若 transition 是 `terminate`
   - 写入 `terminal`
   - `status = terminal.run_status`
   - `phase = terminated`

### 关键规则

- 决策只决定 outcome
- 真正的跳转逻辑来自 definition

---

## 9.7 `renderFinalOutput`

```ts
function renderFinalOutput(params: {
  definition: SopDefinition;
  state: RunState;
}): JsonObject;
```

### 行为

- 只允许在终止态调用
- 解析 `final_output` 表达式
- 返回最终 JSON 对象

### 规则

- 若引用不存在，应报错，而不是静默吞掉
- 终止态必须可重复渲染

---

## 10. 表达式求值设计

表达式求值在 `core` 中非常关键，因为：

- 步骤输入靠它渲染
- `final_output` 靠它渲染
- `idempotency_key_template` 之类未来也可能靠它渲染

第一版建议只支持最小子集。

### 10.1 支持的语法

1. 直接引用
   - `${run.input.company}`
   - `${steps.extract_news.output.records}`
   - `${steps.generate_report.artifacts.report_md}`

2. `coalesce`
   - `${coalesce(steps.a.output.x, steps.b.output.x, [])}`

### 10.2 不支持

- 任意函数调用
- 条件表达式
- 算术运算
- 用户自定义函数
- 任意脚本执行

### 10.3 求值上下文

第一版只允许引用：

- `run.input`
- `steps.<step_id>.output`
- `steps.<step_id>.artifacts`

### 10.4 未命中的行为

需要区分两种情况：

1. **直接引用未命中**
   - 视为错误
2. **`coalesce(...)` 的中间项未命中**
   - 继续尝试下一项

### 10.5 静态校验和运行时求值分工

- validator 负责“语法对不对、引用目标看起来存不存在”
- core 负责“当前 run state 下能不能真正取到值”

---

## 11. 输入渲染规则

`buildStepPacket()` 里的输入渲染建议按以下顺序：

1. 取出步骤定义里的 `inputs`
2. 深度遍历所有值
3. 对字符串中的 `${...}` 做表达式求值
4. 生成最终 `inputs`
5. 不在这里做模板字符串渲染以外的副作用

### 规则

- 渲染失败应立即报错
- 当前步骤无法渲染输入时，不能继续执行
- 上游步骤结果只能读取 `accepted_results`

---

## 12. Step Result 接纳规则

`applyStepResult()` 是最容易把边界搞乱的地方，需要定死规则。

### 12.1 允许接纳的前提

- run 未终止
- 当前 phase 允许接纳结果
- `step_id` 匹配 `current_step_id`
- `attempt` 匹配 `current_attempt`

### 12.2 字段白名单

允许字段：

- `run_id`
- `step_id`
- `attempt`
- `status`
- `output`
- `artifacts`
- `error`
- `metrics`

不允许任何建议性字段。

### 12.3 输出校验

当执行器返回 `status = success` 时：

- `output` 必须满足 `output_schema`
- 若不满足，则将该结果规范化为 `invalid_output`

### 12.4 状态收敛

接纳后，应该更新：

- `accepted_results[current_step_id]`
- `steps[current_step_id].status`
- `steps[current_step_id].last_result_status`
- `history`
- `phase = awaiting_decision`

---

## 13. Decision 接纳规则

### 13.1 允许接纳的前提

- run 未终止
- 当前 `phase = awaiting_decision`
- `step_id` 和 `attempt` 匹配当前上下文

### 13.2 outcome 校验

必须满足：

- outcome 在 `allowed_outcomes` 里
- outcome 在 `transitions` 里有定义

### 13.3 retry 校验

如果决策选了“重试类 outcome”，则必须满足：

- 当前步骤存在 `retry_policy`
- `current_attempt < max_attempts`

否则应该报 `InvalidDecisionError`。

### 13.4 跳转后的状态

- 跳向自己：`attempt + 1`
- 跳向其他步骤：`attempt = 1`
- terminate：进入终止态

---

## 14. 错误模型

建议 `core` 使用**领域错误**，而不是把所有失败都塞成普通字符串。

```ts
type CoreError =
  | { code: "definition_invalid"; diagnostics: Diagnostic[] }
  | { code: "run_input_invalid"; diagnostics: Diagnostic[] }
  | { code: "invalid_state"; message: string }
  | { code: "step_result_rejected"; message: string }
  | { code: "decision_rejected"; message: string }
  | { code: "expression_evaluation_failed"; message: string };
```

### 建议

- `validateDefinition()` 返回 `ValidationReport`
- 其他 API 失败时可以抛 `CoreError`
- 或统一封装成 `Result<T, CoreError>`

如果要优先追求调用简洁，第一版可以先用 typed error。

---

## 15. Core 与其他层的接口边界

### 15.1 Core 与 Validator

关系：

- `core` 依赖 `validator`
- definition 准入和运行期 `output_schema` 检查都可以复用 validator 能力

边界：

- validator 不知道 run state
- core 不重写一套 schema 规则

### 15.2 Core 与 Runtime

关系：

- runtime 调用 core
- runtime 管持久化、调度、外部交互

边界：

- runtime 不能绕过 core 直接改 run state 语义
- core 不关心状态存在内存、文件还是数据库

### 15.3 Core 与 Executor Driver

关系：

- core 只产出 `CoreStepPacket`
- executor driver 执行后回传 `ExecutorResult`

边界：

- executor driver 不得修改 transition 语义
- core 不知道 executor 是 shell、sandbox 还是 model

### 15.4 Core 与 Decision Provider

关系：

- decision provider 读取上下文并产出 `Decision`

边界：

- provider 不得直接给 `next_step`
- core 不知道 decision 来自人、规则还是 LLM

---

## 16. 推荐的最小内部模块

如果单独实现 `core` 包，建议内部至少拆成这些模块：

- `run-state.ts`
  - `RunState`、`StepState`、状态辅助函数
- `definition-guard.ts`
  - definition 准入封装
- `input-resolver.ts`
  - 步骤输入渲染
- `expression-parser.ts`
  - 表达式 AST
- `expression-evaluator.ts`
  - 表达式求值
- `step-packet.ts`
  - `buildStepPacket`
- `step-result.ts`
  - `applyStepResult`
- `decision.ts`
  - `applyDecision`
- `final-output.ts`
  - `renderFinalOutput`
- `errors.ts`
  - `CoreError`

不要一开始就把所有逻辑塞进一个 `engine.ts` 大文件。

---

## 17. 推荐测试策略

`core` 的测试应该以 fixture 和状态迁移为中心。

### 17.1 Definition 测试

- 合法 definition 可通过
- 非法 `entry_step`
- 非法 transition
- 非法表达式引用

### 17.2 输入渲染测试

- 直接引用成功
- `coalesce` 成功
- 引用缺失时报错

### 17.3 Step Result 测试

- 正常 success
- output schema 不匹配变 `invalid_output`
- 错 step_id
- 错 attempt
- 非法附加字段

### 17.4 Decision 测试

- 合法 continue
- 合法 retry
- retry 超限
- 非法 outcome
- terminate 成功

### 17.5 回放测试

给定一串固定输入事件：

- 每次运行都应得到同样的终态

---

## 18. 第一版建议裁剪范围

为了让 `core` 尽快稳定，第一版建议只做这些能力：

1. 单活跃步骤
2. JSON-based SOP definition
3. `run.input` / `steps.output` / `steps.artifacts` 引用
4. `coalesce(...)`
5. `success / timeout / tool_error / sandbox_error / invalid_output`
6. `continue / retry / fail_run / complete` 这类 outcome

先不要做：

- 并行步骤
- 条件语言
- 动态插入步骤
- 动态修改 definition
- 嵌套子流程
- 补偿事务

这些都应该在第一版核心语义稳定之后再扩。

---

## 19. 当前结论

`core` 的本质不是 orchestrator facade，也不是 server runtime，而是：

**一套对 SOP 执行过程做确定性建模的状态机语义层。**

它只做三件最重要的事：

1. 解释 definition
2. 接纳事实
3. 执行合法状态迁移

只要这个边界守住，外面接 CLI、MCP、OpenAI Agents、LangGraph、任意 sandbox，都会比较轻。
