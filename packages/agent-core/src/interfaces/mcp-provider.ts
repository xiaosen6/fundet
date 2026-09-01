import type { AgentKind } from '../types/common.js';

export type McpCallerKind = 'root' | 'descendant' | 'unknown';

export interface McpProviderContext {
  agentKind: AgentKind;
  workingDir: string;
  vendorOptions?: Record<string, unknown>;
  /**
   * Business 层 session id (host 通过 createSession 的 opts.id 提供, 由 maker.ts
   * 透传给 agent.startSession 后落到这里)。MCP server 工厂可以闭包绑定本字段,
   * 让 tool handler 知道 "我在哪个 session 里被调用"。
   *
   * 注意: 与 SDK 内部 sdkSessionId 不同 (sdk id 是 SDK 自己生成的, 走 handle.id)。
   * 全局 ctx 场景 (如 codex HTTP MCP bridge, 见 desktop 的 codexEnvironment.ts)
   * 不会在 server factory 阶段注入本字段, 取到 undefined 表示 "当前调用来源
   * 无法绑定到单个 session"。
   */
  sessionId?: string;
  /**
   * Maker 为本次内存 Session 实例铸造的唯一代号。business sessionId 可在
   * close/rebuild 后复用；权限相关 MCP 不得只凭 sessionId 借用新实例状态。
   * 宿主可把它作为 opaque route identity 放进 harness 的本地 MCP URL，
   * 但不得下发成模型或插件可控的工具参数。
   */
  sessionInstanceId?: string;
  /** Host-owned caller provenance; never sourced from model tool arguments. */
  mcpCallerKind?: McpCallerKind;
  /** True only when the harness bridge has installed provenance enforcement. */
  mcpCallerAttested?: boolean;
  /**
   * 返回当前 tool-call 绑定的真实 session ctx。
   *
   * Claude in-process MCP 通常直接闭包绑定 per-session ctx；Codex HTTP bridge
   * 是长生命周期全局 server，server factory 阶段只能拿到空 ctx，因此需要在
   * tool-call 时从 host 的请求上下文恢复真实 session。控制类工具必须优先读
   * 这里的调用时 ctx，再回退到闭包 ctx；不要信任工具入参自报身份。
   */
  getSessionContext?: () => McpProviderContext | undefined;
}

/**
 * McpProvider — host 注入给 agent 的 MCP server 提供者。
 *
 * maker-core 只认识 provider 这个抽象，不知道具体 MCP 属于飞书、Google
 * 还是图片生成。每次启动 SDK Query 时 provider 都可以返回一个新的
 * Claude SDK mcpServers config，因此 in-process McpServer 实例不会跨 Query 复用。
 */
export interface McpProvider {
  /** MCP server 唯一名（host 自定义） */
  name: string;
  /** 按 session 上下文决定是否启用，例如飞书 bot MCP 只给 source='feishu' 会话。 */
  isEnabled?(context: McpProviderContext): boolean;
  /** Provider 需要额外注入给 agent 子进程的 env，例如远程 MCP bearer token。 */
  getExtraEnv?(context: McpProviderContext): Promise<Record<string, string> | null> | Record<string, string> | null;
}
