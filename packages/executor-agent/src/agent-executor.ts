import {
  ExecutorAdapter,
  ExecutorHandlerInput,
  buildSuccessResult,
  buildToolErrorResult,
} from '@sop-runtime/adapter-core';
import { JsonObject, StepPacket, StepResult, isJsonSafeValue, isStrictPlainObject } from '@sop-runtime/definition';

/**
 * Interface for a host-provided agent runner.
 *
 * 宿主提供的代理运行器接口。
 */
export interface AgentRunner {
  /** Execute a task and return the result. 执行任务并返回结果。 */
  run(task: AgentTask, options?: AgentRunOptions): Promise<AgentResult>;
}

/**
 * Runtime execution options passed to AgentRunner.run.
 *
 * 传递给 AgentRunner.run 的执行选项。
 */
export interface AgentRunOptions {
  /** Optional abort signal (not used in 0.2). 可选的 AbortSignal（0.2 暂不支持）。 */
  signal?: AbortSignal;
}

/**
 * Task data forwarded from the SOP runtime to the agent runner.
 *
 * 从 SOP 运行时转发给代理运行器的任务数据。
 */
export interface AgentTask {
  /** Run identifier. 运行标识。 */
  run_id: string;
  /** SOP definition identifier. SOP 定义标识。 */
  sop_id: string;
  /** SOP version string. SOP 版本号。 */
  sop_version: string;
  /** Step identifier. 步骤标识。 */
  step_id: string;
  /** Current attempt number. 当前尝试次数。 */
  attempt: number;
  /** Resolved step inputs. 已解析的步骤输入。 */
  inputs: Record<string, unknown>;
  /** Executor config including agent_key, system_prompt, etc. 执行器配置。 */
  config: Record<string, unknown>;
  /** Whether network access is allowed. 是否允许网络访问。 */
  allow_network: boolean;
}

/**
 * Result produced by an AgentRunner.
 *
 * AgentRunner 产生的结果。
 */
export interface AgentResult {
  /** Structured output (must be a JSON object). 结构化输出。 */
  output: Record<string, unknown>;
  /** Optional named artifact references. 可选的命名制品引用。 */
  artifacts?: Record<string, string>;
  /** Optional execution metrics. 可选的执行指标。 */
  metrics?: Record<string, unknown>;
}

/**
 * Configuration shape for agent executor steps in SOP definitions.
 *
 * SOP 定义中代理执行器步骤的配置结构。
 */
export interface AgentExecutorConfig {
  /** Key used to select the active runner from the runners map. 用于从 runners 映射中选择运行器的键名。 */
  agent_key?: string;
  /** System prompt forwarded to the agent (adapter does not interpret). 转发给代理的系统提示词（适配器不解释）。 */
  system_prompt?: string;
}

/**
 * Options for creating an agent executor adapter.
 *
 * 创建代理执行器适配器的选项。
 */
export interface AgentExecutorOptions {
  /** Map of runner keys to AgentRunner instances. 运行器键名到 AgentRunner 实例的映射。 */
  runners: Record<string, AgentRunner>;
  /** Default runner key used when agent_key is not set. 未设置 agent_key 时使用的默认运行器键名。 */
  defaultRunner?: string;
}

interface SelectRunnerContext {
  packet: StepPacket;
  config: Record<string, unknown>;
  defaultRunner?: string;
}

function selectRunner(
  runners: Record<string, AgentRunner>,
  ctx: SelectRunnerContext,
): { runner: AgentRunner } | { errorResult: StepResult } {
  const agentKey = ctx.config['agent_key'];
  if (typeof agentKey === 'string') {
    const runner = runners[agentKey];
    if (!runner) {
      return { errorResult: buildToolErrorResult(ctx.packet, 'agent_runner_not_found', `Agent runner "${agentKey}" not found.`) };
    }
    return { runner };
  }
  if (ctx.defaultRunner !== undefined) {
    const runner = runners[ctx.defaultRunner];
    if (!runner) {
      return { errorResult: buildToolErrorResult(ctx.packet, 'agent_runner_not_found', `Default runner "${ctx.defaultRunner}" not found.`) };
    }
    return { runner };
  }
  const keys = Object.keys(runners);
  if (keys.length === 1) {
    return { runner: runners[keys[0]!]! };
  }
  return { errorResult: buildToolErrorResult(ctx.packet, 'agent_runner_not_selected', 'Could not determine which agent runner to use.') };
}

/**
 * Execute the agent step via the selected runner.
 *
 * 通过选定的运行器执行代理步骤。
 */
async function executeAgent(
  input: ExecutorHandlerInput,
  options: AgentExecutorOptions,
): Promise<StepResult> {
  const packet = input.packet as StepPacket;
  const { runners, defaultRunner } = options;

  if (Object.keys(runners).length === 0) {
    return buildToolErrorResult(packet, 'agent_invalid_config', 'No agent runners configured.');
  }

  const selected = selectRunner(runners, { packet, config: input.config as Record<string, unknown>, defaultRunner });
  if ('errorResult' in selected) {
    return selected.errorResult;
  }

  const task: AgentTask = {
    run_id: packet.run_id,
    sop_id: input.definition.sop_id,
    sop_version: input.definition.version,
    step_id: packet.step_id,
    attempt: packet.attempt,
    inputs: packet.inputs as Record<string, unknown>,
    config: input.config as Record<string, unknown>,
    allow_network: packet.executor.allow_network,
  };

  let agentResult: AgentResult;
  try {
    agentResult = await selected.runner.run(task, { signal: input.signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildToolErrorResult(packet, 'agent_runner_error', `Agent runner error: ${message}`);
  }

  if (!isStrictPlainObject(agentResult.output)) {
    return buildToolErrorResult(packet, 'agent_invalid_output', 'Agent runner returned non-object output.');
  }

  // Verify output is JSON-safe (no undefined, NaN, Date, cycles, etc.)
  try {
    JSON.stringify(agentResult.output);
  } catch {
    return buildToolErrorResult(packet, 'agent_invalid_output', 'Agent runner output is not JSON-serializable.');
  }

  // Catch NaN/Infinity/undefined that JSON.stringify silently mangles
  if (!isJsonSafeValue(agentResult.output)) {
    return buildToolErrorResult(packet, 'agent_invalid_output', 'Agent runner output is not JSON-safe.');
  }

  const result = buildSuccessResult(packet, agentResult.output as JsonObject, agentResult.artifacts);
  if (agentResult.metrics) {
    return { ...result, metrics: agentResult.metrics as JsonObject };
  }
  return result;
}

/**
 * Create an agent executor adapter that dispatches steps to host-registered AgentRunners.
 *
 * 创建代理执行器适配器，将步骤分发给宿主注册的 AgentRunner。
 *
 * @param options - Runner configuration. 运行器配置。
 * @returns An ExecutorAdapter for the agent kind. 代理类型的 ExecutorAdapter。
 * @public
 */
export function createAgentExecutor(options: AgentExecutorOptions): ExecutorAdapter {
  return {
    kind: 'agent',
    name: 'local_agent',
    description: 'Executes steps via a host-registered AgentRunner',
    handler: (input) => executeAgent(input, options),
  };
}
