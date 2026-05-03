# `@sop-runtime/core`

`@sop-runtime/core` 是 SOP 执行系统里的纯状态机层。它没有 I/O，不依赖外部端口，只负责在给定 definition 和输入数据上做确定性的状态机运算。

## 什么时候读

当你需要理解 SOP run 的生命周期如何推进——run 如何创建、step result 如何被接纳、decision 如何导致状态转移、最终输出如何渲染——时，读这个包。若只是想先跑通完整流程，建议从[根 README](../../README.md) 和 [`@sop-runtime/runtime`](../runtime/README.md) 开始。

## 包定位

这个包位于依赖链的第三层：

```text
definition -> validator -> core -> runtime
```

它提供一组**纯函数**，每个函数接收输入，经过校验后返回新状态或抛出 `CoreError`。核心函数包括：

- `createRun`：根据 definition 和 input 创建初始 `RunState`。
- `buildStepPacket`：从当前 run state 构建发给执行器的 `StepPacket`，沿途解析表达式模板。
- `applyStepResult`：将执行器返回的 `StepResult` 接纳到 run state，规范化非法状态、校验输出 schema、记录历史。
- `applyDecision`：将 `Decision`（next_step、retry、terminate）应用到 run state，推进或结束 run。
- `renderFinalOutput`：根据 definition 的 `final_output` 模板渲染最终输出。
- `getCurrentStep`：从 run state 中提取当前步骤的快照视图。
- `pauseRun` / `resumeRun` / `terminateRun`：运行时控制面函数，修改 run 的阶段和状态。

它不负责：

- 定义 SOP 类型或表达式解析器（由 [`@sop-runtime/definition`](../definition/README.md) 负责）。
- 校验 definition 是否可以准入（由 [`@sop-runtime/validator`](../validator/README.md) 负责）。
- 真正调用执行器、持久化状态、生成决策或提供时钟（由 [`@sop-runtime/runtime`](../runtime/README.md) 负责）。

每个函数都会校验前置条件，并在不满足时抛出 `CoreError`，而不是静默降级。

## 对外暴露内容

公共入口是 [`src/index.ts`](./src/index.ts)，导出以下内容：

**核心函数：**

| 导出 | 作用 |
|---|---|
| `createRun` | 根据 definition 和 input 创建初始 `RunState` |
| `buildStepPacket` | 从 run state 构建执行器入站 `StepPacket` |
| `applyStepResult` | 将 `StepResult` 合并到 run state |
| `applyDecision` | 将 `Decision` 应用到 run state |
| `renderFinalOutput` | 渲染 `final_output` 模板 |
| `getCurrentStep` | 获取当前步骤快照视图 |
| `pauseRun` | 将 run 标记为 paused |
| `resumeRun` | 将 paused run 恢复为 ready |
| `terminateRun` | 终止 run 并记录终止原因 |

**错误类型：**

| 导出 | 作用 |
|---|---|
| `CoreError` | 带错误码 (`CoreErrorCode`) 的结构化错误类 |

**次要导出：**

| 导出 | 作用 |
|---|---|
| `CoreStepPacket` | `buildStepPacket` 返回的增强 packet 类型 |
| `CurrentStepView` | `getCurrentStep` 返回的步骤视图类型 |

典型导入方式：

```ts
import {createRun, applyStepResult, applyDecision, CoreError} from '@sop-runtime/core';
```

## 核心概念

### 1. createRun：初始化

`createRun({ definition, input, runId, now? })` 做三件事：

1. 校验 definition：调用 `validateDefinition`，不通过则抛 `CoreError('definition_invalid')`。
2. 合并并校验输入：`definition.defaults` 与 `input` 合并后，按 `definition.input_schema` 校验；不通过则抛 `CoreError('run_input_invalid')`。
3. 构建初始 `RunState`：设置 entry step 为 `active`，其余为 `pending`，记录 `run_created` 历史条目。

返回的 `RunState` 处于 `running / ready` 阶段，current_step_id 指向 entry_step。

### 2. buildStepPacket：构建执行器入站包

`buildStepPacket({ definition, state })` 从 run state 构建 `StepPacket`，同时：

- 解析 step inputs 中的表达式模板（如 `${run.input.x}` → run 的实际输入值）。
- 解析 executor config 中的表达式模板。
- 解析 policy keys（idempotency、concurrency）中的表达式模板。
- 校验前置条件：run 必须在 `ready` 阶段，否则抛 `CoreError('invalid_state')`。

返回的 `CoreStepPacket` 包含解析后的 inputs、executor 配置和策略 key。

### 3. applyStepResult：接纳执行结果

`applyStepResult({ definition, state, result })` 将执行器返回的 `StepResult` 合并到 run state：

1. **规范化**：将非法 status（不在 `ACCEPTED_STEP_RESULT_STATUSES` 中）转换为 `invalid_output`，保留原始信息和错误详情。
2. **输出 schema 校验**：如果 `status === 'success'`，校验 `output` 是否符合 step 的 `output_schema`；不通过则转换为 `invalid_output`。
3. **Step 状态推进**：更新当前 step 的 `status`、`attempt_count`，记录 accepted result。
4. **历史记录**：追加 `step_result_accepted` 历史条目。
5. **阶段推进**：将 run phase 从 `ready` 推进到 `awaiting_decision`。

成功的接纳不改变 run 的 `status`（仍为 `running`），只改变 `phase`。

### 4. applyDecision：应用监督决策

`applyDecision({ definition, state, decision })` 接收监督方（人或 Agent）的 `Decision`，驱动状态机推进：

1. **校验决策**：验证 `Decision` 结构是否合法（`decision_validation.ts`），包括 `outcome_id` 是否在 `allowed_outcomes` 中。
2. **转移判定**（`decision_transition.ts`）：
   - **next_step**：将当前步骤标记为 completed，目标步骤从 pending 变为 active，run 回到 `ready` 阶段。
   - **retry**：将当前步骤标记为 retrying，重置 attempt 计数或按 backoff 推进，run 回到 `ready` 阶段。
   - **terminate**：将当前步骤标记为 terminated，run 进入 `terminated` 阶段，status 设为 `succeeded` / `failed` / `cancelled`。
3. **历史记录**：追加 `decision_applied` 历史条目。

### 5. renderFinalOutput：渲染最终输出

`renderFinalOutput({ definition, state })` 在 run 以 `succeeded` 终止后，根据 `definition.final_output` 模板渲染最终输出。模板引用方式与 step inputs 相同（`${steps.<id>.output.x}`），引用不可达步骤会抛 `CoreError('expression_evaluation_failed')`。

### 6. 控制面函数

- `pauseRun` / `resumeRun`：phase 在 `paused` 和 `ready` / `awaiting_decision` 之间切换，记录 `run_paused` / `run_resumed` 历史。
- `terminateRun`：强制终止 run，记录 `run_terminated` 历史，可指定终止原因。

### 7. getCurrentStep：安全的步骤视图

`getCurrentStep({ definition, state })` 返回当前步骤的只读快照，包含 `step_definition`、`step_state` 和 `accepted_result`（如有）。返回的是浅拷贝，调用方修改返回值不会影响原始 state。run 已终止时返回 `null`。

## 函数契约

所有核心函数遵循统一的设计模式：

- **纯函数**：不修改入参，返回新对象。
- **防御性校验**：前置条件不满足时抛出 `CoreError`，不做静默降级。
- **类型安全**：入参和返回值都有精确的 TypeScript 类型。
- **无副作用**：不执行 I/O、不写日志、不发射事件。

`CoreError` 包含 `code`（机器可读的错误码）、`message`（人类可读的描述）和可选的 `diagnostics`（来自 `@sop-runtime/validator` 的校验诊断）和 `details`（额外上下文）。

错误码一览：

| 错误码 | 触发场景 |
|---|---|
| `definition_invalid` | `createRun` 发现 definition 校验不通过 |
| `run_input_invalid` | `createRun` 发现 run input 不符合 input_schema |
| `invalid_state` | 状态机前置条件不满足（如 phase 不对、sop_id 不匹配） |
| `step_result_rejected` | `applyStepResult` 收到结构非法的 StepResult |
| `decision_rejected` | `applyDecision` 收到结构非法的 Decision |
| `expression_evaluation_failed` | 表达式模板解析失败或引用不可达 |

## 文件清单与职责

### 源码

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](./src/index.ts) | 公共导出入口 |
| [`src/core_error.ts`](./src/core_error.ts) | `CoreError` 类和 `CoreErrorCode` 定义 |
| [`src/create_run.ts`](./src/create_run.ts) | `createRun`：初始化 RunState |
| [`src/build_step_packet.ts`](./src/build_step_packet.ts) | `buildStepPacket`：构建执行器入站包 |
| [`src/apply_step_result.ts`](./src/apply_step_result.ts) | `applyStepResult`：接纳执行结果 |
| [`src/step_result_validation.ts`](./src/step_result_validation.ts) | StepResult 结构校验 |
| [`src/step_result_normalization.ts`](./src/step_result_normalization.ts) | 非法 status 到 `invalid_output` 的规范化 |
| [`src/accepted_result.ts`](./src/accepted_result.ts) | AcceptedStepResult 辅助逻辑 |
| [`src/apply_decision.ts`](./src/apply_decision.ts) | `applyDecision`：应用监督决策 |
| [`src/decision_validation.ts`](./src/decision_validation.ts) | Decision 结构校验 |
| [`src/decision_transition.ts`](./src/decision_transition.ts) | 三种决策转移（next_step / retry / terminate） |
| [`src/decision_history.ts`](./src/decision_history.ts) | 决策相关历史条目构建 |
| [`src/step_result_history.ts`](./src/step_result_history.ts) | step result 历史条目构建 |
| [`src/expression_evaluator.ts`](./src/expression_evaluator.ts) | `evaluateExpressionTemplate`：运行时表达式求值 |
| [`src/render_final_output.ts`](./src/render_final_output.ts) | `renderFinalOutput`：最终输出渲染 |
| [`src/get_current_step.ts`](./src/get_current_step.ts) | `getCurrentStep`：当前步骤快照 |
| [`src/pause_run.ts`](./src/pause_run.ts) | `pauseRun`：暂停 run |
| [`src/resume_run.ts`](./src/resume_run.ts) | `resumeRun`：恢复 run |
| [`src/terminate_run.ts`](./src/terminate_run.ts) | `terminateRun`：终止 run |

### 测试文件

| 文件 | 关注点 |
|---|---|
| [`test/index.test.ts`](./test/index.test.ts) | 公共导出和基本集成：createRun → getCurrentStep → buildStepPacket |
| [`test/create_run.test.ts`](./test/create_run.test.ts) | createRun 的 definition 校验、input 合并、初始状态构建 |
| [`test/build_step_packet.test.ts`](./test/build_step_packet.test.ts) | 表达式模板解析、前置条件校验、policy key 渲染 |
| [`test/step_result_validation.test.ts`](./test/step_result_validation.test.ts) | StepResult 结构校验边界 |
| [`test/step_result_normalization.test.ts`](./test/step_result_normalization.test.ts) | 非法 status 到 `invalid_output` 的规范化 |
| [`test/apply_step_result_test_helpers.ts`](./test/apply_step_result_test_helpers.ts) | applyStepResult 测试辅助（共享 fixture） |
| [`test/apply_decision_test_helpers.ts`](./test/apply_decision_test_helpers.ts) | applyDecision 测试辅助（共享 fixture） |
| [`test/decision_validation.test.ts`](./test/decision_validation.test.ts) | Decision 结构校验 |
| [`test/decision_next_step_transition.test.ts`](./test/decision_next_step_transition.test.ts) | next_step 转移 |
| [`test/decision_retry_transition.test.ts`](./test/decision_retry_transition.test.ts) | retry 转移 |
| [`test/decision_termination_transition.test.ts`](./test/decision_termination_transition.test.ts) | terminate 转移 |
| [`test/render_final_output.test.ts`](./test/render_final_output.test.ts) | final_output 模板渲染 |
| [`test/pause_run.test.ts`](./test/pause_run.test.ts) | pauseRun 的行为边界 |
| [`test/resume_run.test.ts`](./test/resume_run.test.ts) | resumeRun 的行为边界 |
| [`test/terminate_run.test.ts`](./test/terminate_run.test.ts) | terminateRun 的行为边界 |
| [`test/get_current_step_paused.test.ts`](./test/get_current_step_paused.test.ts) | paused 状态下 getCurrentStep 的行为 |

### 构建产物与缓存

| 文件/目录 | 作用 | 是否推荐直接阅读 |
|---|---|---|
| `dist/*.js` | TypeScript 编译后的 JavaScript 输出 | 不推荐，除非排查构建结果 |
| `dist/*.d.ts` | TypeScript 声明文件 | 可用于核对导出面 |
| `tsconfig.tsbuildinfo` | TypeScript 增量编译缓存 | 不推荐 |

## 依赖顺序

这个包的内部函数之间没有直接调用关系（它们是独立的纯函数），但从数据流的角度看，自然顺序是：

```text
createRun
  └── 得到 RunState

buildStepPacket
  └── 从 RunState 构建 StepPacket

（StepPacket → 执行器 → StepResult）

applyStepResult
  ├── step_result_validation
  ├── step_result_normalization
  ├── accepted_result
  ├── step_result_history
  └── 得到 phase=awaiting_decision 的 RunState

（RunState + StepResult → 决策者 → Decision）

applyDecision
  ├── decision_validation
  ├── decision_transition (next_step / retry / terminate)
  ├── decision_history
  └── 得到新 phase 的 RunState（ready / terminated）

（循环直到 terminated）

renderFinalOutput
  └── 从 terminated RunState 渲染最终输出
```

控制面函数（pauseRun / resumeRun / terminateRun）和 getCurrentStep 无前后依赖，可在 run 生命周期的任意合规阶段调用。

## 推荐阅读顺序

### 如果你是包使用者

推荐顺序（关注函数契约而非实现细节）：

1. [`src/core_error.ts`](./src/core_error.ts)：理解错误模型
2. [`src/create_run.ts`](./src/create_run.ts)：理解 run 的初始化
3. [`src/build_step_packet.ts`](./src/build_step_packet.ts)：理解执行器入站包
4. [`src/apply_step_result.ts`](./src/apply_step_result.ts)：理解结果接纳
5. [`src/apply_decision.ts`](./src/apply_decision.ts)：理解决策应用
6. [`src/render_final_output.ts`](./src/render_final_output.ts)：理解最终输出
7. [`src/get_current_step.ts`](./src/get_current_step.ts)：理解步骤视图
8. [`src/pause_run.ts`](./src/pause_run.ts)、[`src/resume_run.ts`](./src/resume_run.ts)、[`src/terminate_run.ts`](./src/terminate_run.ts)：控制面

### 如果你是仓库内开发者

推荐顺序（从底层到上层）：

1. [`src/core_error.ts`](./src/core_error.ts)
2. [`src/create_run.ts`](./src/create_run.ts)
3. [`src/build_step_packet.ts`](./src/build_step_packet.ts)
4. [`src/step_result_validation.ts`](./src/step_result_validation.ts)、[`src/step_result_normalization.ts`](./src/step_result_normalization.ts)
5. [`src/apply_step_result.ts`](./src/apply_step_result.ts)
6. [`src/decision_validation.ts`](./src/decision_validation.ts)、[`src/decision_transition.ts`](./src/decision_transition.ts)
7. [`src/apply_decision.ts`](./src/apply_decision.ts)
8. [`src/expression_evaluator.ts`](./src/expression_evaluator.ts)、[`src/render_final_output.ts`](./src/render_final_output.ts)
9. [`src/get_current_step.ts`](./src/get_current_step.ts)
10. [`src/pause_run.ts`](./src/pause_run.ts)、[`src/resume_run.ts`](./src/resume_run.ts)、[`src/terminate_run.ts`](./src/terminate_run.ts)
11. [`src/index.ts`](./src/index.ts)

## 测试文件说明

测试按职责分三类：

- **行为测试**：按函数拆分的独立测试文件（`create_run.test.ts`、`build_step_packet.test.ts`、`render_final_output.test.ts` 等），覆盖成功路径和错误路径。
- **决策转移测试**：`decision_next_step_transition.test.ts`、`decision_retry_transition.test.ts`、`decision_termination_transition.test.ts`，分别覆盖三种决策转移的细节。
- **集成测试**：`index.test.ts` 串联 createRun → getCurrentStep → buildStepPacket 验证基本流程，同时验证 getCurrentStep 的返回值不可变性。

测试辅助文件（`apply_step_result_test_helpers.ts`、`apply_decision_test_helpers.ts`）提供共享 fixture，减少测试文件间的重复定义。

## 与 `@sop-runtime/runtime` 的关系

两个包的边界是**纯状态机 vs 带端口编排**：

- `@sop-runtime/core` 是纯函数，只做状态变换，不关心 I/O、持久化、时钟或决策来源。
- `@sop-runtime/runtime` 的 `RuntimeHost` 将这些纯函数与 `StateStore`、`StepExecutor`、`DecisionProvider`、`Clock` 等端口组合起来，形成可运行的主循环。

核心的调用链条在 runtime 中体现为：

```text
RuntimeHost.runReadyStep
  → core.buildStepPacket（构建入站包）
  → executor dispatch（I/O）
  → core.applyStepResult（接纳结果）

RuntimeHost.applyDecision
  → DecisionProvider.decide（决策来源）
  → core.applyDecision（应用决策）
```

如果想理解某个 RuntimeHost 行为为什么抛出特定错误，通常应该回到 core 的对应函数和它的前置校验中寻找答案。
