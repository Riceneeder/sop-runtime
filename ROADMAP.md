# ROADMAP

本路线图将 `sop-runtime` 定位为一个可嵌入的、确定性的 SOP 执行内核。近期重点不是 npm 发布、UI、MCP server 或分布式编排，而是让 runtime 更容易被嵌入，并通过清晰的 adapter 契约连接真实执行环境。

## 0.1-alpha：本地基线

状态：基本完成。

目标：为仓库建立一个可在本地验证的 alpha 基线。

范围：

- package metadata 与 workspace 边界整理
- schema / example 导出
- 最小 CLI：`validate`、`trace`、`run`
- `executor.config` alpha 契约
- 本地验证脚本：`check`、`smoke:cli`、`check:alpha`
- alpha contract 与 executor config 相关文档

建议收尾事项：

- 添加或确认根目录 `LICENSE`
- 文档中说明当前暂不进行 npm 发布
- 保留 `pack:dry-run` 作为 package artifact 边界检查，而不是发布承诺
- 运行并记录 `bun run check:alpha` 结果

## 0.2-alpha：Adapter 基线

目标：将 `sop-runtime` 从“可运行 demo 的状态机 runtime”推进为“能够通过统一 adapter 契约调用真实工具、agent、API 和工作区文件的嵌入式工作流内核”。

### 0.2.1 Adapter 契约与核心工具

状态：基本完成。

- 新增 `docs/design/executor_adapters.md`
  - 聚焦当前 `RuntimeHost.registerExecutor(kind, name, handler)` 契约
  - 解释 handler 输入输出、`StepResult`、错误处理、`executor.config`、timeout、resource limits 和示例
  - 仅将 shell / agent / http / file / MCP / OpenCode 作为 adapter 分类或未来方向简要提及，不展开协议级设计

- 新增 `@sop-runtime/adapter-core`
  - 将 `ExecutorHandler` 和 `ExecutorHandlerInput` 作为主定义放在该包
  - runtime 从 adapter-core 导入并继续 re-export，保持兼容
  - 新增 StepResult builder helpers
  - 新增 adapter error normalization helpers
  - 新增轻量 config reader helpers
  - 新增 secret / header redaction helpers
  - 为 adapter 作者提供或 re-export `resolveExecutorConfigTemplate`

- 保持 `@sop-runtime/runtime` 导出兼容
  - 现有 runtime 导入路径继续可用
  - 新 adapter 包推荐优先从 `@sop-runtime/adapter-core` 导入

- 本阶段不迁移 `ToolRegistryExecutor`
  - 保留在 runtime 中作为 legacy compatibility

### 0.2.2 第一批 Executor Adapters

- 新增 `@sop-runtime/executor-shell`
  - `kind: "shell"`，`name: "local_command"`
  - 使用 spawn 风格 API 执行本地命令，不支持不受限制的 shell interpolation
  - 支持 JSON stdin、stdout / stderr 捕获、exit code 映射、timeout 映射和显式错误
  - 新增 `examples/shell_workflow`

- 新增 `@sop-runtime/executor-agent`
  - `kind: "agent"`，`name: "local_agent"`
  - 定义一个小型 `AgentRunner` 接口
  - 将 `packet.inputs` 映射为 agent task input
  - 将 agent output 映射为 `StepResult`
  - 新增包含 mock agent 的 `examples/agent_workflow`

- 新增 `@sop-runtime/executor-http`
  - `kind: "http"`，`name: "request"`
  - 支持 method / url / headers / body config
  - 执行前检查 `allow_network === true`
  - 日志和错误中对敏感 headers 做脱敏
  - 将非 2xx 响应和网络错误映射为显式 `tool_error`

- 新增 `@sop-runtime/executor-file`
  - `kind: "file"`，name 可为 `read`、`write` 或 `operation`
  - 限制访问显式 workspace root
  - 防止路径穿越
  - 支持将大文件或文件型结果作为 artifacts 返回

验收标准：

- `bun run check` 通过
- `bun run smoke:adapter` 通过
- shell adapter 可以执行本地命令并返回 `StepResult`
- agent adapter 可以调用 mock agent 并返回 `StepResult`
- HTTP adapter 在 `allow_network` 为 false 时拒绝执行
- file adapter 不能逃逸 workspace root
- adapters 不伪造成功、不静默 fallback、不直接修改 `RunState`

### 0.2.3 Decision、Event 与本地持久化示例

状态：已完成。

- 新增 `RuleBasedDecisionProvider` 示例（`packages/runtime/src/rule_based_decision_provider.ts`）
  - 展示如何基于 accepted step output 通过 expression template 规则选择非默认分支
  - 规则按数组顺序 first-match-wins，未匹配时可配置 fallback outcome 或显式报错

- 新增 `JsonlEventSink`（`packages/runtime/src/jsonl_event_sink.ts`）
  - 将 runtime events 以每行一个 JSON object 的形式追加写入文件
  - Promise 链串行化保证事件顺序
  - 写入失败时显式 reject，不吞错

- 新增 `FileStateStore`（`packages/runtime/src/file_state_store.ts`）
  - 面向本地 demo 和开发场景的 JSON 文件持久化 StateStore
  - 原子写入（临时文件 + rename），Promise 互斥锁串行化实例内操作
  - 明确声明不支持多进程并发安全（SQLite 延后到 0.3）
  - 从 `InMemoryStateStore` 提取 `state_store_helpers.ts` 共享纯函数

- 新增 `RuleBasedDecisionRule` 类型导出
- 新增 39 个测试覆盖所有新组件

### 0.2.4 Adapter 冒烟测试

- 新增 `smoke:adapter`
- 新增 `smoke:shell`
- 新增 `smoke:agent`
- HTTP adapter 就绪后新增 `smoke:http`
- 新增 `check:adapter = check + smoke:adapter`

## 0.3-alpha：Runtime 强化

目标：在 adapter 语义被验证后，强化 runtime 与存储模型。

范围：

- 支持 AbortSignal 的 executor 和 decision provider cancellation
- 对支持 cancellation 的 adapter 提供更强 timeout 语义
- SQLite `StateStore`
  - transactions
  - idempotency / concurrency key 唯一索引
  - 持久化 run state 和 run record
- event log persistence
- step / decision lease 或 CAS 设计
- 单 run 多 worker 安全模型
- definition resolver 或轻量 definition registry
- shell / agent / http / file adapter 兼容性测试

验收标准：

- SQLite store 实现原子 `claimRunStart`
- 进程重启后可以恢复 run state
- 支持 timeout 的 adapter 能在底层能力允许时取消正在执行的工作
- step / decision 并发风险被文档化，或通过 lease / CAS 原型进行保护

## 0.4-alpha：生态 Adapter

目标：在基础 adapter 模型稳定后，连接更广泛的自动化与 agent 生态。

候选 adapter：

- `@sop-runtime/executor-mcp`
  - 优先做 MCP client adapter，而不是 MCP server
  - 调用已有 MCP tool，并将结果映射为 `StepResult`

- `@sop-runtime/executor-opencode`
  - 将 SOP step 连接到 OpenCode 风格的 coding task

- `@sop-runtime/executor-browser`
  - 基于 Playwright 或同类工具执行浏览器自动化
  - 截图和下载文件作为 artifacts 返回

- `@sop-runtime/executor-sandbox`
  - 提供 reference sandbox adapter
  - 除非经过验证，否则只声明为参考隔离能力，不声明为完整安全边界

- `@sop-runtime/executor-python` 或 code-interpreter adapter
  - 支持数据处理和研究型工作流

- `@sop-runtime/executor-job`
  - 将 step 投递到外部 job system
  - 将 job result 映射回 `StepResult`

- `@sop-runtime/executor-human-task`
  - 创建人工任务作为 SOP step
  - 与 human decision provider 保持边界清晰

## 长期方向

`sop-runtime` 的长期价值是为 agentic workflow 和 tool-based workflow 提供确定性的 SOP 执行骨架：

- SOP definition 描述流程
- runtime 强制执行状态转移与校验
- executor adapters 连接真实执行环境
- decision providers 选择受监督的流程分支
- stores 和 event sinks 让 run 具备持久化与可观测性

项目应避免变成泛化 agent framework，而应保持为一个小而严格的 runtime kernel，并在其周围建设高质量 adapters。
