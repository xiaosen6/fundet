/**
 * verbAggregator —— 工作流块折叠头的「动词聚合摘要」（Cindy
 * cc-agent-compact-blocks v2 同款，zh-CN 文案照抄其 locale；Fundet 无
 * i18n 框架，中文短语直接内联）。
 * ---------------------------------------------------------------------------
 * "Edited 3 files, ran 2 commands…" / 「编辑 3 个文件、运行 2 条命令和
 * 读取 1 个文件」——把一段工具调用收敛成一行。
 *
 * 工具名 → 动词映射是静态表（Cindy ADR-1）；动词排序固定（ORDER），多动词
 * 摘要不随到达顺序漂移；>5 个动词截断「另外 N 项」。
 */

export type Verb =
  | 'edited'
  | 'created'
  | 'ran'
  | 'read'
  | 'updated'
  | 'searched'
  | 'fetched'
  | 'used';

export interface VerbEntry {
  verb: Verb;
  count: number;
}

export interface AgentActionSummary {
  /** 已按 ORDER 排序并截断到 ≤5 项。 */
  verbs: VerbEntry[];
  /** 工具调用总数（截断前）。 */
  totalCalls: number;
  /** 被截断掉的动词数；0 = 无截断。 */
  truncatedExtra: number;
}

/** MCP 双下划线前缀的工具取短名（mcp__search__web_search → web_search） */
export function shortToolName(name: string): string {
  return name.includes('__') ? (name.split('__').pop() ?? name) : name;
}

const TOOL_TO_VERB: Record<string, Verb> = {
  // CC 大写族
  Edit: 'edited',
  MultiEdit: 'edited',
  Write: 'created',
  Bash: 'ran',
  exec: 'ran',
  Read: 'read',
  TodoWrite: 'updated',
  todo: 'updated',
  Glob: 'searched',
  Grep: 'searched',
  WebFetch: 'fetched',
  WebSearch: 'fetched',
  web_search: 'fetched',
  search: 'fetched',
  // pi 内置小写族
  bash: 'ran',
  read: 'read',
  ls: 'read',
  list: 'read',
  edit: 'edited',
  write: 'created',
  grep: 'searched',
  find: 'searched',
  glob: 'searched',
};

const ORDER: Verb[] = ['edited', 'ran', 'read', 'updated', 'created', 'searched', 'fetched', 'used'];

/** 聚合短语（zh-CN，Cindy locale 同文案；中文不分单复数） */
const PART_TEXT: Record<Verb, (count: number) => string> = {
  edited: (c) => `编辑 ${c} 个文件`,
  created: (c) => `创建 ${c} 个文件`,
  ran: (c) => `运行 ${c} 条命令`,
  read: (c) => `读取 ${c} 个文件`,
  updated: () => '更新待办',
  searched: () => '执行搜索',
  fetched: () => '访问网络',
  used: (c) => `调用 ${c} 个工具`,
};

export function verbForTool(toolName: string): Verb {
  return TOOL_TO_VERB[shortToolName(toolName)] ?? TOOL_TO_VERB[toolName] ?? 'used';
}

/** 一段工具调用 → 段摘要（排序 + 截断） */
export function aggregateVerbs(toolNames: readonly string[]): AgentActionSummary {
  const counter = new Map<Verb, number>();
  for (const name of toolNames) {
    const v = verbForTool(name);
    counter.set(v, (counter.get(v) ?? 0) + 1);
  }
  let entries: VerbEntry[] = ORDER.flatMap((verb) => {
    const count = counter.get(verb);
    return count === undefined ? [] : [{ verb, count }];
  });
  const truncatedExtra = entries.length > 5 ? entries.length - 5 : 0;
  if (truncatedExtra > 0) entries = entries.slice(0, 5);
  return { verbs: entries, totalCalls: toolNames.length, truncatedExtra };
}

/** 摘要 → 折叠头一行文本（「编辑 3 个文件、运行 2 条命令和读取 1 个文件」） */
export function formatSummary(summary: AgentActionSummary): string {
  const parts: string[] = summary.verbs.map((e) => PART_TEXT[e.verb](e.count));
  if (summary.truncatedExtra > 0) parts.push(`另外 ${summary.truncatedExtra} 项`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join('、')}和${parts[parts.length - 1]}`;
}

/** 行级动词 label（zh-CN，Cindy locale 同文案） */
export const ROW_VERB_TEXT: Record<Verb, string> = {
  edited: '编辑',
  created: '创建',
  ran: '运行',
  read: '读取',
  updated: '更新',
  searched: '搜索',
  fetched: '访问',
  used: '调用',
};
