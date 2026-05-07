# 0.2.2 Executor Adapter Packages

本文档定义 `@sop-runtime/executor-shell`、`@sop-runtime/executor-agent`、`@sop-runtime/executor-http`、`@sop-runtime/executor-file` 四个 executor adapter 包的设计。

所有 adapter 遵循以下原则：
- 不直接修改 `RunState`
- 不伪造 `success`
- 不静默 fallback
- 所有错误必须映射为明确的 `StepResult`
- 安全策略由 adapter options（宿主控制）而非 SOP definition 决定
- executor-* 生产代码只依赖 `@sop-runtime/adapter-core` 和 `@sop-runtime/definition`，不依赖 `@sop-runtime/runtime`

---

## 1. Shell Executor (`@sop-runtime/executor-shell`)

用于执行宿主允许的本地命令，**不**通过 shell 字符串拼接执行命令。

### Config（SOP definition 中声明）

```ts
interface ShellExecutorConfig {
  command: string;    // 命令别名，adapter 映射为绝对路径
  args: string[];     // 固定参数，不做 shell interpolation
  cwd?: string;       // 相对 workspaceRoot 的工作目录，可选
}
```

### Adapter Options（宿主创建时传入）

`allowedCommands` 使用别名到绝对路径的映射，不依赖 PATH 查找，防止 PATH hijacking。

```ts
interface ShellExecutorOptions {
  workspaceRoot: string;
  allowedCommands: Record<string, string>;  // alias → absolute executable path
  baseEnv?: Record<string, string>;
  maxStderrBytes?: number;   // 默认 64KB
  maxStdoutBytes?: number;   // 默认 1MB
}
```

`command` 在 SOP config 中使用别名：
```json
{ "command": "node", "args": ["scripts/echo.mjs"] }
```

adapter 解析为 `options.allowedCommands["node"]` 的绝对路径。找不到别名 → `tool_error: shell_command_not_allowed`。

stdout 上限取宿主选项和 resource_limits 的更小值：
```
effectiveMaxStdout = min(options.maxStdoutBytes ?? 1MB, packet.executor.resource_limits.max_output_bytes)
```

stderr 上限仅由 `options.maxStderrBytes` 控制（默认 64KB），防止非零退出时大量 stderr 进入 `error.details`。

### 输入规则

stdin 写入 JSON：
```json
{
  "run_id": "...",
  "step_id": "...",
  "attempt": 1,
  "inputs": {},
  "config": {}
}
```

### 校验规则

- `args` 必须为 `string[]`，每项必须是 string → 否则 `tool_error: shell_invalid_config`
- `command` / `args` / `cwd` 不允许包含 NUL 字符（`\0`）→ 否则 `tool_error: shell_invalid_config`

### 执行规则

1. `command` 别名必须在 `allowedCommands` 中 → 否则 `tool_error: shell_command_not_allowed`
2. 解析为绝对路径后，可执行文件不存在或不可执行 → `tool_error: shell_executable_not_found`
3. 使用 `Bun.spawn([executable, ...args])`，不使用 `shell: true`
4. 启动失败（Bun.spawn 抛错）→ `tool_error: shell_spawn_failed`
5. `cwd` 相对 `workspaceRoot` 解析，不能逃逸
6. env = `baseEnv` + `packet.executor.env`，不继承 `process.env`
7. timeout 使用 `packet.executor.timeout_secs`
8. 超时后必须 `proc.kill()` 并等待进程退出
9. stdout 有上限捕获（`effectiveMaxStdout`），超过 → `tool_error: shell_stdout_too_large`
10. stderr 有上限捕获（`maxStderrBytes`），超过则截断后继续记录，不单独导致失败

### 输出规则

| 条件 | status | error.code |
|------|--------|------------|
| exit code 0 | success | - |
| exit code 非 0 | tool_error | `shell_exit_nonzero` |
| command alias 不在 allowedCommands | tool_error | `shell_command_not_allowed` |
| executable 不存在或不可执行 | tool_error | `shell_executable_not_found` |
| Bun.spawn 抛错 | tool_error | `shell_spawn_failed` |
| stdout 超限 | tool_error | `shell_stdout_too_large` |
| timeout（adapter kill） | timeout | `shell_timeout` |
| config 无效 | tool_error | `shell_invalid_config` |

exit code 0 时 stdout → output 映射：
- stdout 为空 → `{}`
- stdout 是 JSON object → parsed object
- stdout 是其他 JSON 值 → `{ value: parsed }`
- stdout 非 JSON → `{ text: stdout }`

exit code 非 0 时 error.details 包含 `exit_code` 及截断后的 `stdout`/`stderr`。

---

## 2. Agent Executor (`@sop-runtime/executor-agent`)

不内置具体 LLM 或 agent framework，只调用宿主提供的 `AgentRunner`。

### 核心接口

```ts
interface AgentRunner {
  run(task: AgentTask, options?: AgentRunOptions): Promise<AgentResult>;
}

interface AgentRunOptions {
  signal?: AbortSignal;  // 为 0.3 AbortSignal cancellation 预留。
                         // 0.2 首版接口保留 signal 字段，但 createAgentExecutor 不主动创建或传入 AbortSignal。
                         // timeout 仍由 runtime 兜底。
                         // 0.3 再由 runtime / adapter-core 统一引入可取消执行。
}

interface AgentTask {
  run_id: string;
  sop_id: string;
  sop_version: string;
  step_id: string;
  attempt: number;
  inputs: JsonObject;
  config: JsonObject;       // 包含 system_prompt 等自定义字段，adapter 不单独解释任何字段
  allow_network: boolean;
}

interface AgentResult {
  output: JsonObject;                     // 必须是 JsonObject
  artifacts?: Record<string, string>;
  metrics?: JsonObject;
}
```

### Config

```ts
interface AgentExecutorConfig {
  agent_key?: string;       // 选择哪个 runner
  system_prompt?: string;   // adapter 不单独处理 system_prompt；
                            // 它只是 config 的普通字段，随 task.config 原样传给 runner。
}
```

### Adapter Options

```ts
interface AgentExecutorOptions {
  runners: Record<string, AgentRunner>;
  defaultRunner?: string;
}
```

### Runner 选择规则

1. `config.agent_key` 存在 → 使用 `runners[agent_key]`
2. 不存在且 `defaultRunner` 存在 → 使用 `runners[defaultRunner]`
3. 不存在且 `runners` 只有一项 → 使用唯一 runner
4. 其他情况 → `tool_error: agent_runner_not_selected`
5. `agent_key` 指向不存在的 runner → `tool_error: agent_runner_not_found`

### 执行规则

- adapter 不直接调用 LLM API，不访问文件系统或网络
- adapter 不单独解析或拼接 config 中任何字段的内容
- `runner.run(task)` 返回非 `JsonObject` 的 output → `tool_error: agent_invalid_output`
- `runner.run(task)` 抛异常 → `tool_error: agent_runner_error`
- timeout 首版由 runtime 兜底（`executeHandlerWithTimeout`），`createAgentExecutor` 不主动传入 AbortSignal；0.3 再由 runtime / adapter-core 统一引入可取消执行
- config 校验失败 → `tool_error: agent_invalid_config`

---

## 3. HTTP Executor (`@sop-runtime/executor-http`)

使用 `fetch()` 发出 HTTP 请求，安全受多重约束。

### Config

```ts
interface HttpExecutorConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: JsonObject;
  body_from?: "config" | "inputs" | "none";
}
```

### Adapter Options

```ts
interface HttpExecutorOptions {
  allowNetwork: boolean;
  allowedOrigins: string[];             // 不允许为空（空数组 = 全部拒绝）
  resolveConfigTemplates?: boolean;     // 默认 false
  sensitiveHeaders?: string[];          // 默认见下文
  maxResponseBytes?: number;            // 默认 1MB
}
```

默认敏感 headers（大小写不敏感）：`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `token`, `secret`, `password`。

`allowedOrigins` 为空时所有请求均拒绝 → `tool_error: http_origin_not_allowed`。`allowedOrigins` 中每项会用 `new URL(origin).origin` 归一化后比较，比较对象是 request URL 的 `URL.origin`，避免协议/端口/末尾斜杠的写法差异。

### 执行规则

1. `options.allowNetwork !== true` → `tool_error: http_network_disabled`
2. `packet.executor.allow_network !== true` → `tool_error: http_step_network_not_allowed`
3. `resolveConfigTemplates === true` 时调用 `resolveExecutorConfigTemplate` 解析 url/headers/body
4. URL 解析后 protocol 必须为 `http:` 或 `https:`
5. URL origin 必须在 `allowedOrigins` 中（`allowedOrigins` 为空时拒绝所有请求）
6. 不允许 URL userinfo（username:password@）
7. GET 不允许 body → `tool_error: http_body_not_allowed`
8. `body_from` 未设置时：如果 `config.body` 存在等同于 `"config"`，不存在等同于 `"none"`
9. `body_from === "inputs"` → request body = `packet.inputs`，忽略 `config.body`
10. `body_from === "none"` 且 `config.body` 存在 → `tool_error: http_invalid_config`
11. body 序列化时若未设 content-type 则自动补 `application/json`
12. 默认 `redirect: "manual"`，不自动跟随 redirect；3xx 返回 `tool_error: http_redirect_not_followed`
13. 使用 `AbortController` 根据 `packet.executor.timeout_secs` 取消 fetch
14. 响应体按 `maxResponseBytes` 限制读取（先检查 Content-Length，再流式限制）
15. request headers 和 response headers 均按 `sensitiveHeaders` 脱敏，`set-cookie` 默认不进 output 或在 output 中脱敏为 `[REDACTED]`
16. config 字段校验失败 → `tool_error: http_invalid_config`

### 输出规则

| 条件 | status | error.code |
|------|--------|------------|
| 2xx | success | - |
| 3xx（redirect manual） | tool_error | `http_redirect_not_followed` |
| 非 2xx | tool_error | `http_non_2xx_response` |
| fetch 网络错误 | tool_error | `http_network_error` |
| adapter abort | timeout | `http_timeout` |
| 响应超限 | tool_error | `http_response_too_large` |
| GET + body | tool_error | `http_body_not_allowed` |
| URL 校验失败 | tool_error | `http_invalid_url` |
| origin 不在白名单 | tool_error | `http_origin_not_allowed` |
| config 无效 | tool_error | `http_invalid_config` |

success output 结构，`body` 必须保证为 `JsonObject`：
```json
{
  "status": 200,
  "status_text": "OK",
  "headers": {},
  "body": {}
}
```

body 归一化规则：
```
JSON object → body = parsed object
JSON array / string / number / boolean / null → body = { value: parsed }
非 JSON 文本 → body = { text: responseText }
空 body → body = {}
```

非 2xx error.details 结构：
```json
{
  "status": 404,
  "status_text": "Not Found",
  "headers": {},
  "body_preview": "{}"
}
```

---

## 4. File Executor (`@sop-runtime/executor-file`)

所有文件操作限制在 `workspaceRoot` 内。

### Config

```ts
interface FileExecutorConfig {
  action: "read" | "write" | "copy" | "move" | "delete";
  path?: string;            // read / write / delete
  encoding?: "utf8" | "base64" | "hex";                        // read
  content?: string | JsonObject;                               // write
  write_encoding?: "utf8" | "base64";                          // write
  overwrite?: boolean;                                          // write / copy / move，默认 false
  source?: string;                                              // copy / move
  destination?: string;                                         // copy / move
}
```

### Adapter Options

```ts
interface FileExecutorOptions {
  workspaceRoot: string;
  maxFileReadBytes?: number;    // 默认 1MB
  maxFileWriteBytes?: number;   // 默认 1MB
  allowWrite?: boolean;         // 默认 false
  allowDelete?: boolean;        // 默认 false
  allowSymlinks?: boolean;      // 默认 false
}
```

### 路径安全规则

1. `workspaceRoot` 先执行 `realpath`
2. 用户路径必须是相对路径（不允许绝对路径传入）
3. `path.resolve(root, userPath)` → `path.relative(root, target)` 不能以 `..` 开头
4. 对已存在的文件/目录做 `realpath` 后再次确认在 `workspaceRoot` 内
5. 默认拒绝 symlink（`allowSymlinks: false`）
6. write 目标不存在时：检查目标路径仍在 `workspaceRoot` 内，对目标**父目录**做 `realpath` 后确认父目录仍在 `workspaceRoot` 内；父目录中存在 symlink 时按 `allowSymlinks` 策略处理

### 各 action 规则

#### read
- `stat.size > maxFileReadBytes` → `tool_error: file_read_too_large`
- output: `{ path, encoding, size_bytes, content }`

#### write
- 需要 `allowWrite === true`
- 自动创建父目录（父目录路径安全按上述规则 + 父目录 realpath 检查）
- `overwrite = false` 时目标已存在 → `tool_error: file_already_exists`
- 写入内容超过 `maxFileWriteBytes` → `tool_error: file_write_too_large`
- JsonObject content → `JSON.stringify(content, null, 2)` 后 UTF-8 写入
- output: `{ path, size_bytes, written: true }`

#### copy
- 需要 `allowWrite === true`（创建新文件）
- source 和 destination 都必须通过路径安全检查
- `overwrite = false` 时目标已存在 → `tool_error: file_already_exists`
- `overwrite = true` 也需要 `allowWrite === true`
- output: `{ source, destination, copied: true }`

#### move
- 需要 `allowWrite === true` 和 `allowDelete === true`（创建新文件并删除 source）
- source 和 destination 都必须通过路径安全检查
- `overwrite = false` 时目标已存在 → `tool_error: file_already_exists`
- `overwrite = true` 也需要 `allowWrite + allowDelete`
- 优先使用 `rename`；遇到 `EXDEV`（跨文件系统）时**不自动 fallback** 为 copy+delete → `tool_error: file_cross_device_move_not_supported`
- output: `{ source, destination, moved: true }`

#### delete
- 需要 `allowDelete === true`
- 仅允许删除普通文件，不删除目录
- 不递归删除
- `allowSymlinks === false` 时遇到 symlink → `tool_error: file_symlink_not_allowed`
- output: `{ path, deleted: true }`

### 错误码

```
file_path_outside_workspace
file_symlink_not_allowed
file_not_found
file_not_file
file_already_exists
file_read_too_large
file_write_too_large
file_write_disabled
file_delete_disabled
file_delete_directory_not_supported
file_copy_failed
file_move_failed
file_delete_failed
file_cross_device_move_not_supported
file_read_failed
file_write_failed
file_invalid_config
```

---

## 包结构（每个 executor 通用）

```
packages/executor-<name>/
├── src/
│   └── index.ts          # 导出 create<Name>Executor → ExecutorHandler
├── test/
│   └── <name>.test.ts
├── package.json           # 依赖 @sop-runtime/adapter-core，不依赖 @sop-runtime/runtime
├── tsconfig.json
└── README.md
```

所有 executor 包的入口都返回 `ExecutorHandler`，通过 `RuntimeHost.registerExecutor(kind, name, handler)` 注册。

函数签名：
```ts
function createShellExecutor(options: ShellExecutorOptions): ExecutorHandler;
function createAgentExecutor(options: AgentExecutorOptions): ExecutorHandler;
function createHttpExecutor(options: HttpExecutorOptions): ExecutorHandler;
function createFileExecutor(options: FileExecutorOptions): ExecutorHandler;
```

API 风格一致：
```ts
import { createShellExecutor } from '@sop-runtime/executor-shell';
import { createAgentExecutor } from '@sop-runtime/executor-agent';
import { createHttpExecutor } from '@sop-runtime/executor-http';
import { createFileExecutor } from '@sop-runtime/executor-file';

host.registerExecutor('shell', 'local_command', createShellExecutor(options));
host.registerExecutor('agent', 'local_agent', createAgentExecutor(options));
host.registerExecutor('http', 'request', createHttpExecutor(options));
host.registerExecutor('file', 'file', createFileExecutor(options));
```

---

## 实现顺序

```
adapter-core         → 已就绪，无需修改
executor-shell       → 第一实现
executor-agent       → 第二实现（接口简洁，适配器核心模式）
executor-file        → 第三实现（安全细节多但功能闭环可控）
executor-http        → 第四实现（测试牵涉 mock server/fetch/redirect/流控）
```

---

## 验收标准

- 每个包 `bun test` 通过
- `bun run check` 通过
- Shell executor 可以执行本地命令并返回 `StepResult`
- Agent executor 可以调用 mock agent 并返回 `StepResult`
- HTTP executor 在 `allow_network` 为 false 时拒绝执行
- File executor 不能逃逸 `workspaceRoot`
- 所有 executor 不伪造成功、不静默 fallback、不直接修改 `RunState`
- 所有 executor 的 `error.details` 不输出未脱敏的 secret、token、authorization、cookie、password 等敏感字段
- 每个 executor 都覆盖 invalid config 测试
- 每个 executor 都覆盖 runtime handler input 不被原地修改
- 每个 executor 都覆盖错误时不会返回 success
- 每个 executor 都覆盖 output 必须为 `JsonObject`
