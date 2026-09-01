/**
 * AgentRuntimeConfig — 部署 + 行为配置（host 注入，Agent 内部组装到 env）。
 *
 * 与 AuthAdapter 拆分原因：
 * - AuthAdapter 只管"真鉴权"（API key / OAuth credentials home 等）
 * - AgentRuntimeConfig 装"接入端点"（proxy URL）+ host 侧业务行为配置
 * - 这样 CLI host 可以一行配置切换不走 proxy；业务 flag 也能交给用户 settings 调
 */

export interface AgentRuntimeConfig {
  /**
   * 接入端点。设为 undefined 表示走 SDK 默认。
   * Pi: 翻译为网关 provider 的 baseUrl。
   */
  endpoint?: string;

  /**
   * Host-validated executable paths that an agent may stage into its private runtime.
   *
   * These are explicit paths rather than PATH entries: read-only tools can otherwise
   * execute a same-named program from an untrusted working directory on Windows.
   */
  managedExecutablePaths?: Readonly<{
    ripgrep?: string;
  }>;

  /**
   * 宿主产品级 system prompt 注入（host 层）。
   * 与 engine 内置 和 per-call 外部 (StartSessionOptions.userPrompt) 区分：
   * 本字段表达"装载本引擎的产品自身的设定"。
   * 最终拼接顺序：engine 内置 → 本字段 → per-call 外部。
   */
  systemPrompt?: string;

  /**
   * 是否启用 agent 的自动记忆。
   * - undefined : 走 agent 自带默认
   * - true/false: host 强制覆盖
   *
   * 运行时可通过 BaseAgent.setMemory(enabled) 改, 不必重启 host。
   */
  memoryEnabled?: boolean;

  /**
   * 是否启用 Maker Memory (跨 agent 共享、host 接管的 workdir-scoped 记忆系统)。
   * - undefined / false : 不启用, 走 agent 各自的原生 memory
   * - true              : 启用 — agent 端在 startSession 时拼 prompt 注入 memory 段 +
   *                        MakerMemoryManager.enable() 联动调各 agent.setMemory(false) 关原生
   *
   * 由 ChatInput 启 session 时透传当前最新值 (跟 userPrompt 同模式), main 不持久化。
   *
   * 跟 memoryEnabled 强制互斥 — 启用时 maker memory 会调 agent.setMemory(false) 关原生,
   * 不允许 (true, true) 共存 (双写会污染 LLM 上下文)。
   */
  makerMemoryEnabled?: boolean;
}
