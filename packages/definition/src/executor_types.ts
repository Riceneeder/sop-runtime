/**
 * Executor configuration types referenced by step definitions.
 *
 * 被步骤定义引用的执行器配置类型。
 */
import {JsonObject} from './json_value.js';
import {ResourceLimits} from './policy_types.js';

/**
 * Generic executor configuration referenced by kind + name.
 *
 * Executor handlers are registered externally via RuntimeHost.registerExecutor(kind, name, handler).
 * The SOP definition only references executors — it does not embed their implementation details.
 *
 * 通用执行器配置，通过 kind + name 引用外部注册的 handler。
 */
export interface ExecutorConfig {
  /**
   * Executor kind used to look up the registered handler.
   *
   * 用于查找已注册 handler 的执行器种类。
   */
  kind: string;
  /**
   * Executor name used to look up the registered handler.
   *
   * 用于查找已注册 handler 的执行器名称。
   */
  name: string;
  /**
   * Optional configuration forwarded to the registered handler.
   *
   * 转发给已注册 handler 的可选配置。
   */
  config?: JsonObject;
  /**
   * Hard timeout for a single attempt, in seconds.
   *
   * 单次尝试的硬超时时间，单位为秒。
   */
  timeout_secs: number;
  /**
   * Whether the executor may access the network.
   *
   * 执行器是否允许访问网络。
   */
  allow_network: boolean;
  /**
   * Environment variables injected into the executor.
   *
   * 注入执行器的环境变量映射。
   */
  env: Record<string, string>;
  /**
   * Resource ceilings enforced for the executor.
   *
   * 对执行器施加的资源上限。
   */
  resource_limits: ResourceLimits;
}
