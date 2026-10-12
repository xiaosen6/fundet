/**
 * work-summary —— 工作组折叠头的「最新一条动作」摘要。
 * ---------------------------------------------------------------------------
 * 工作组默认折叠（用户拍板：命令全展开太乱，折叠时也要看到 agent 当前
 * 在干嘛）——取组内最后一个 tool 条目生成单行文本；纯思考段没有动作，
 * 返回 null（折叠头回落纯 label）。
 */

/** MCP 双下划线前缀的工具取短名（mcp__srv__bash → bash） */
export function shortToolName(name: string): string {
  return name.includes('__') ? (name.split('__').pop() ?? name) : name;
}

interface ToolItemLike {
  kind: 'tool';
  toolName: string;
  input: Record<string, unknown>;
}

function basenameOf(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

function inputString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

const TOOL_LABELS: Record<string, string> = {
  read: '读取',
  glob: '搜索文件',
  grep: '搜索内容',
  list: '列目录',
  todo: '更新计划',
  search: '联网搜索',
};

/** 命令首行去空白截断（折叠头单行预算） */
function firstLineOf(command: string, max = 90): string {
  const line = command.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const s = line.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 最新一条动作的单行摘要：bash 给命令首行；文件类工具给「动词 文件名」；
 * 其余给中文动词或工具短名。组内无 tool 条目（纯思考）返回 null。
 */
export function summarizeLatestWork(children: ReadonlyArray<ToolItemLike | { kind: 'thinking' }>): string | null {
  const last = [...children].reverse().find((c): c is ToolItemLike => c.kind === 'tool');
  if (!last) return null;
  const name = shortToolName(last.toolName).toLowerCase();
  if (name === 'bash' || name === 'shell' || name === 'exec') {
    const cmd = inputString(last.input, ['command', 'cmd', 'script']);
    return cmd ? firstLineOf(cmd) : '执行命令';
  }
  const file = inputString(last.input, ['path', 'file_path', 'filePath', 'target']);
  if (name === 'write' || name === 'edit') return `编辑 ${file ? basenameOf(file) : '文件'}`;
  if (name === 'read') return `读取 ${file ? basenameOf(file) : '文件'}`;
  if (file && TOOL_LABELS[name]) return `${TOOL_LABELS[name]} ${basenameOf(file)}`;
  return TOOL_LABELS[name] ?? shortToolName(last.toolName);
}
