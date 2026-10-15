/**
 * 记忆功能共享常量与类型（渲染/主进程共用，纯数据无 Node/Electron API）。
 */

export const MEMORY_ENABLED_SETTING = 'memory.enabled';

/**
 * 全局记忆仓 scope 键（两层模型：项目仓按工作目录 + 全局仓跨所有会话/目录共享）。
 * 取 '_global'：agent-core 的 sanitizeWorkdir 对它恒等，且真实绝对路径必含
 * 盘符冒号/分隔符，sanitize 后永远不会等于它——不与任何项目仓目录撞名。
 */
export const MEMORY_GLOBAL_SCOPE_KEY = '_global';

/** 写入路由：这些类型默认进全局仓（用户偏好/反馈纠偏跨项目共享），其余进项目仓 */
export const MEMORY_GLOBAL_TYPES: ReadonlySet<string> = new Set(['user', 'feedback']);

export const MEMORY_MCP_SERVER_NAME = 'fundet-memory';

/** 入口工具（渐进式发现，Cindy cindy_memory 同模式：常驻 prompt 只有这两个） */
export const MEMORY_MCP_LIST_TOOLS = 'list_tools';
export const MEMORY_MCP_CALL_TOOL = 'call_tool';

/** call_tool 可调用的细粒度工具名 */
export const MEMORY_INNER_TOOLS = [
  'memory_list',
  'memory_read',
  'memory_write',
  'memory_delete',
  'memory_search',
  'memory_consolidate',
] as const;
export type MemoryInnerToolName = (typeof MEMORY_INNER_TOOLS)[number];

/** 记忆类型（与 agent-core memory/types.ts 的 MEMORY_TYPES 对齐；UI 展示用） */
export const MEMORY_TYPE_LABELS: Record<string, string> = {
  user: '用户偏好',
  feedback: '反馈纠偏',
  project: '项目上下文',
  reference: '外部参考',
  digest: '压缩摘要',
};

export interface MemoryRecordView {
  filename: string;
  type: string;
  title: string;
  description: string;
  updatedAt: string;
  body: string;
  sizeBytes: number;
}

export interface MemoryScopeView {
  /** meta.json 记录的工作目录绝对路径（store 键） */
  absWorkdir: string;
  /** 磁盘上的记忆仓目录绝对路径 */
  scopeDir: string;
  recordCount: number;
  updatedAt: string | null;
}
