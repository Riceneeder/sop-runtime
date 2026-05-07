# Executor Adapters

本文定义 0.1-alpha 中 executor adapter 的责任边界。它面向实现宿主集成的人，而不是 SOP definition 作者。

## What is an executor adapter?

Executor adapter 是宿主侧的执行集成层。它把 SOP step 中的 `executor.kind`、`executor.name`、`executor.config` 映射到真实执行能力，例如工具调用、shell、沙箱、MCP、LLM 或外部服务。

Adapter 不属于 SOP JSON 协议本身。SOP definition 只声明“要调用哪个 executor”，不嵌入 executor 的实现。

## Registration

`RuntimeHost.registerExecutor(kind, name, handler)` 是 adapter 接入 RuntimeHost 的入口。

RuntimeHost 在执行 step 时按 `packet.executor.kind + packet.executor.name` 查找 handler。未注册时抛出 `RuntimeError('executor_not_registered')`。

Adapter 可以直接提供一个 `ExecutorHandler`，也可以封装成函数或类并在内部注册多个 handler。RuntimeHost 不理解 adapter 内部实现，只负责分发、timeout guard、resource limit 检查和 core 状态推进。

## Input

Handler 接收 `ExecutorHandlerInput`：

```ts
{
  packet: {
    run_id: string;
    step_id: string;
    attempt: number;
    inputs: JsonObject;
    output_schema?: JsonObject;
    executor: {
      kind: string;
      name: string;
      config?: JsonObject;
      timeout_secs: number;
      allow_network: boolean;
      env: Record<string, string>;
      resource_limits: {
        max_output_bytes: number;
        max_artifacts: number;
      };
    };
  };
  definition: SopDefinition;
  state: RunState;
  config: JsonObject;
}
```

`packet.inputs` 已由 core 从 step `inputs` 模板解析完成。`packet.executor.config` 保留 definition 中的原始形态；RuntimeHost 不自动解析其中的表达式模板。`config` 是 convenience 字段，等于 `packet.executor.config ?? {}`。

Handler 输入会被 RuntimeHost 克隆后传入。Adapter 不应依赖修改输入对象来影响 definition、run state 或后续状态机行为。

## Output

Handler 必须返回 `StepResult`：

```ts
{
  run_id: string;
  step_id: string;
  attempt: number;
  status: 'success' | 'timeout' | 'tool_error' | 'sandbox_error';
  output?: JsonObject;
  artifacts?: Record<string, string>;
  error?: StepError | null;
  metrics?: JsonObject;
}
```

`run_id`、`step_id`、`attempt` 必须对应当前 packet。状态推进只能由 RuntimeHost 调用 core 完成；adapter 不允许直接写 store 或绕过状态机。

`success.output` 必须是 JSON object。`artifacts` 必须是字符串到字符串的映射。`metrics` 是可选 JSON object。

## Errors

可预期的执行失败应返回失败态 `StepResult`：

- `tool_error`：工具、命令、远端 API 或 handler 业务调用失败。
- `sandbox_error`：隔离环境、权限、资源或沙箱机制失败。
- `timeout`：adapter 自己已经明确检测到超时并返回的结果。

失败结果应包含稳定的 `error.code`、可读的 `error.message`，以及可序列化的 `error.details`。

Adapter 不应吞掉错误或伪造成功。不可恢复的程序错误、不变量破坏、错误配置导致的内部异常可以直接抛出，让 RuntimeHost 暴露失败。

## Timeout

RuntimeHost 会用 `executor.timeout_secs` 包裹 handler。超过时限后，RuntimeHost 返回：

```ts
{
  status: 'timeout',
  error: {
    code: 'executor_timeout',
    message: '...',
    details: { timeout_secs: number },
  },
}
```

0.1-alpha 中这不是硬取消。RuntimeHost 超时后不再把迟到的 handler 成功结果用于状态推进，但底层进程、请求或沙箱任务是否停止，取决于 adapter 自己。

如果 adapter 启动外部进程、网络请求或长任务，应在 adapter 内实现清理和取消逻辑。当前标准 handler 输入没有 `AbortSignal`。

## Resource limits

`executor.resource_limits` 包含：

- `max_output_bytes`：`success.output` 的 JSON 序列化字节上限。
- `max_artifacts`：任意 status 下允许返回的 artifact 数量上限。

RuntimeHost 会在 handler 原始返回值上检查这些限制，并在 `afterStep` hook 改写结果后再次检查。超限会收敛为 `status: 'sandbox_error'`。

Adapter 仍应尽量在真实执行层提前落实资源约束，例如限制 stdout、artifact 数量、文件大小、进程资源或沙箱 quota。RuntimeHost 的检查是状态机入口的最终保护，不等价于真实沙箱资源隔离。

## executor.config templates

`executor.config` 默认是 handler-owned opaque JSON。Core、validator 和 RuntimeHost 都不解释其中的表达式引用。

Adapter 允许解析 `executor.config` 模板，但必须显式 opt in：

```ts
import {resolveExecutorConfigTemplate} from '@sop-runtime/runtime';
// or, for adapter-only packages:
// import { resolveExecutorConfigTemplate } from '@sop-runtime/adapter-core';

const resolvedConfig = resolveExecutorConfigTemplate({
  config: ctx.config,
  context: {run: ctx.state},
});
```

模板解析失败应暴露为明确失败。Adapter 不应静默保留未解析模板，也不应用 mock 或 fallback 值伪造执行成功。

## Network access

`executor.allow_network` 表达该 step 是否允许 executor 访问网络。

RuntimeHost 不提供网络隔离，也不会拦截 adapter 的网络调用。支持网络能力的 adapter 必须读取并执行这个约束；当 `allow_network` 为 `false` 时，应在 adapter 或底层沙箱中禁止网络访问。

如果 adapter 无法落实网络隔离，应在文档或注册处明确说明，不应把 `allow_network: false` 表述成已经被强制执行。

## Sandbox responsibility

RuntimeHost 不是 sandbox。它只负责：

- 按 `kind + name` 分发 handler。
- 为 handler 调用设置 timeout guard。
- 检查返回结果的 resource limits。
- 把 `StepResult` 交给 core 校验和状态推进。

如果 executor 声称提供 sandbox 能力，隔离责任属于 adapter 或 adapter 调用的底层执行环境。包括文件系统隔离、网络隔离、环境变量注入、进程权限、CPU/内存/磁盘限制和 artifact 收集。

## Minimal adapter skeleton

```ts
import {
  ExecutorHandler,
  RuntimeHost,
} from '@sop-runtime/runtime';
// or, for adapter-only packages:
// import { ExecutorHandler } from '@sop-runtime/adapter-core';

const handler: ExecutorHandler = async (ctx) => {
  try {
    const result = await callExternalTool({
      inputs: ctx.packet.inputs,
      config: ctx.config,
      env: ctx.packet.executor.env,
      allowNetwork: ctx.packet.executor.allow_network,
    });

    return {
      run_id: ctx.packet.run_id,
      step_id: ctx.packet.step_id,
      attempt: ctx.packet.attempt,
      status: 'success',
      output: result.output,
      artifacts: result.artifacts,
      metrics: result.metrics,
    };
  } catch (error) {
    return {
      run_id: ctx.packet.run_id,
      step_id: ctx.packet.step_id,
      attempt: ctx.packet.attempt,
      status: 'tool_error',
      error: {
        code: 'external_tool_failed',
        message: toErrorMessage(error),
      },
    };
  }
};

const host = new RuntimeHost({store});
host.registerExecutor('tool', 'external_tool', handler);
```

`callExternalTool` 和 `toErrorMessage` 是 adapter 自己的实现。它们不属于 runtime 公共 API。

## Current non-goals

0.1-alpha 不提供以下能力：

- 标准 `AbortSignal` 传递。
- 分布式 worker lease 或 CAS 协调。
- 内置 shell/sandbox executor。
- 内置 MCP/OpenCode adapter。
- RuntimeHost 级别的网络或文件系统隔离。

这些能力可以由具体 adapter 或后续 runtime 版本提供。
