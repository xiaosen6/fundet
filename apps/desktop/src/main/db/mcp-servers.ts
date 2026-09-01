/**
 * mcp_servers 表读写：用户配置的外部 MCP server（stdio / streamable-http）。
 * 会话启动时由 host/mcp-bridge.ts 读取 enabled 的行注入 pi。
 */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { getDb } from './client.js';
import { mcpServers, type McpServerRow } from './schema.js';

export interface McpServerView {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  /** stdio */
  command: string | null;
  args: string[];
  /** http */
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface McpServerInput {
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** JSON 列解析兜底：单条脏数据不拖垮整个列表 */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toView(row: McpServerRow): McpServerView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command,
    args: parseJson<string[]>(row.args, []),
    url: row.url,
    headers: parseJson<Record<string, string>>(row.headers, {}),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

export function listMcpServers(): McpServerView[] {
  return getDb().select().from(mcpServers).orderBy(asc(mcpServers.createdAt)).all().map(toView);
}

export function getMcpServer(id: string): McpServerView | null {
  const row = getDb().select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  return row ? toView(row) : null;
}

/** 输入校验：类型与必填字段（stdio=command，http=url） */
function validate(input: McpServerInput): void {
  // server 名会拼进 pi 工具名 mcp__<name>__<tool>，限制字符集
  if (!/^[a-zA-Z0-9_-]+$/.test(input.name.trim())) {
    throw new Error('MCP server 名称只能含字母 / 数字 / _ / -');
  }
  if (input.type === 'stdio' && !input.command?.trim()) {
    throw new Error('stdio 类型必须填写 command');
  }
  if (input.type === 'http') {
    if (!input.url?.trim()) throw new Error('http 类型必须填写 url');
    // 与 cindy-bridge 的 isAllowedMcpUrl 同边界：非 loopback 必须 https，禁 URL 内嵌凭证
    let parsed: URL;
    try {
      parsed = new URL(input.url.trim());
    } catch {
      throw new Error('url 不是合法 URL');
    }
    if (parsed.username || parsed.password) throw new Error('url 不允许内嵌用户名/密码');
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw new Error('url 仅允许 https，或 loopback（127.0.0.1/localhost）的 http');
    }
  }
}

export function createMcpServer(input: McpServerInput): McpServerView {
  validate(input);
  const row = {
    id: randomUUID(),
    name: input.name.trim(),
    type: input.type,
    command: input.type === 'stdio' ? input.command!.trim() : null,
    args: JSON.stringify(input.args ?? []),
    url: input.type === 'http' ? input.url!.trim() : null,
    headers: JSON.stringify(input.type === 'http' ? (input.headers ?? {}) : {}),
    enabled: input.enabled === false ? 0 : 1,
    createdAt: Date.now(),
  };
  getDb().insert(mcpServers).values(row).run();
  return toView(row);
}

export function updateMcpServer(id: string, patch: Partial<McpServerInput>): McpServerView {
  const current = getMcpServer(id);
  if (!current) throw new Error(`MCP server not found: ${id}`);
  const merged: McpServerInput = {
    name: patch.name ?? current.name,
    type: patch.type ?? current.type,
    command: patch.command ?? current.command ?? undefined,
    args: patch.args ?? current.args,
    url: patch.url ?? current.url ?? undefined,
    headers: patch.headers ?? current.headers,
    enabled: patch.enabled ?? current.enabled,
  };
  validate(merged);
  getDb()
    .update(mcpServers)
    .set({
      name: merged.name.trim(),
      type: merged.type,
      command: merged.type === 'stdio' ? merged.command!.trim() : null,
      args: JSON.stringify(merged.args ?? []),
      url: merged.type === 'http' ? merged.url!.trim() : null,
      headers: JSON.stringify(merged.type === 'http' ? (merged.headers ?? {}) : {}),
      enabled: merged.enabled === false ? 0 : 1,
    })
    .where(eq(mcpServers.id, id))
    .run();
  return getMcpServer(id)!;
}

export function deleteMcpServer(id: string): void {
  getDb().delete(mcpServers).where(eq(mcpServers.id, id)).run();
}
