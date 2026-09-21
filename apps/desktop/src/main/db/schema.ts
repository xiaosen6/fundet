/**
 * Fundet 本地数据库 schema（better-sqlite3 + drizzle）。
 *
 * 表：
 * - sessions：会话元数据（对应 agent-core 的 SessionMeta，外加产品层 status 列）
 * - messages：会话消息（content 为 JSON 字符串，按消息语义拆行）
 * - providers：BYOK provider 配置；API key 不入库，走 electron safeStorage（host/secrets.ts）
 * - settings：main 进程开关
 * - mcp_servers：用户配置的外部 MCP
 */
import { primaryKey, sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentKind: text('agent_kind').notNull().default('pi'),
  title: text('title').notNull().default(''),
  workDir: text('work_dir').notNull(),
  model: text('model').notNull(),
  effort: text('effort'),
  permissionMode: text('permission_mode'),
  /** 产品层状态：active / closed；与 agent-core 的运行时瞬态无关 */
  status: text('status').notNull().default('active'),
  /** pi 内部 session id（SDK 侧），用于 resume */
  sdkSessionId: text('sdk_session_id'),
  /** 置顶（1=置顶段，列表置顶 + 可拖拽排序） */
  pinned: integer('pinned').notNull().default(0),
  /** 置顶段内的手动序（大者靠上；非置顶恒 0，按 updatedAt 排） */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** user / assistant / tool / done 等 */
    role: text('role').notNull(),
    /** JSON 字符串：文本消息为 {text}，工具事件为原始事件 data */
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_messages_session').on(t.sessionId)],
);

/**
 * 自动化（定时例行任务）：定义 + 每次运行记录。
 * 幂等补列在 client.ts initDatabase 里 raw SQL 创建（对齐 messages_fts 同款做法，
 * drizzle-kit 大版本迁移留给后续）。会话 id 以 auto- 前缀隔离（不进侧栏会话列表）。
 */
export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 触发类型：hourly/daily/weekdays/weekly/monthly/cron */
  schedule: text('schedule').notNull(),
  /** daily/weekly/monthly 的 HH:MM（本地时区）；hourly 空 */
  time: text('time'),
  /** weekly 0-6（0=周日）；monthly 1-31 */
  day: integer('day'),
  /** cron 表达式（schedule=cron 时） */
  cron: text('cron'),
  /** 发送给 agent 的指令 */
  instructions: text('instructions').notNull(),
  workDir: text('work_dir').notNull(),
  /** active / paused */
  status: text('status').notNull().default('active'),
  /** 下次触发时间（ms epoch）；paused 时保留原值 */
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  /** 运行会话（auto-<runId>，不出现在侧栏） */
  sessionId: text('session_id').notNull(),
  /** queued / running / success / failed */
  status: text('status').notNull().default('queued'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
});

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** pi 原生 api 形态 */
  api: text('api', {
    enum: ['anthropic-messages', 'openai-responses', 'openai-completions'],
  }).notNull(),
  baseUrl: text('base_url').notNull(),
  /** JSON 数组：[{id, reasoning?, contextWindow?, maxTokens?}] */
  models: text('models').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** 简单 key-value 设置表：需被 main 进程读取的开关；renderer-only 的仍走 localStorage */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** 用户配置的外部 MCP server（stdio / streamable-http），会话启动时经 MCP 桥注入 pi */
export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['stdio', 'http'] }).notNull(),
  /** stdio：可执行命令（如 npx） */
  command: text('command'),
  /** stdio：JSON 数组字符串，如 ["-y", "@scope/pkg"] */
  args: text('args'),
  /** http：streamable-http endpoint（非 loopback 必须 https，bridge 侧强制） */
  url: text('url'),
  /** http：JSON 对象字符串 {header名: 值}；值只进 pi 父进程 env，不进桥描述符 */
  headers: text('headers'),
  /** 1/0；禁用的 server 不注入新会话 */
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
export type McpServerRow = typeof mcpServers.$inferSelect;

/** providers.models 列的 JSON 元素形状 */
export interface ProviderModelSpec {
  id: string;
  reasoning?: boolean;
  /** 思考档位映射（推理模型必配，缺了 zai 系端点不发 thinking 会 1210） */
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
  /** false = 不出现在模型选择器（Cindy 式「Shown in Model Picker」） */
  enabled?: boolean;
  /** 显式声明的输入模态；只信库值（预设标注 / 编辑对话框勾选） */
  input?: Array<'text' | 'image'>;
}

/** 每日用量累计（turn 级增量落库；tokenUsage/costUsd 均为会话累计值做差） */
export const usageDaily = sqliteTable('usage_daily', {
  day: text('day').notNull(),
  model: text('model').notNull(),
  tokens: integer('tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.model] })]);
