/**
 * 工具调用的显示文本助手（思路参考 Cindy ToolCallCard 的 getToolSummary，精简重写）。
 *
 * pi 内置工具名小写（bash/read/edit/write/glob/grep/find/ls），入参键为
 * command / path；同时兼容 CC 风格大写名 + file_path，防御性取别名。
 */

/** 工具名 → 摘要行优先取的关键参数 */
const KEY_PARAM_MAP: Record<string, string[]> = {
  bash: ['command'],
  read: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  write: ['path', 'file_path'],
  glob: ['pattern', 'path'],
  grep: ['pattern', 'query', 'path'],
  find: ['pattern', 'path'],
  ls: ['path'],
};

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** 一行摘要，如 `read(src/auth.ts)` / `bash(pnpm test)` */
export function getToolSummary(toolName: string, input: unknown): string {
  const inp = (input ?? null) as Record<string, unknown> | null;
  if (!inp) return `${toolName}()`;
  const keys = KEY_PARAM_MAP[toolName.toLowerCase()];
  const hit = keys ? firstString(inp, keys) : undefined;
  return hit ? `${toolName}(${truncate(hit, 60)})` : `${toolName}()`;
}

/** 审批卡正文：优先抽关键参数，抽不到回退截断 JSON */
export function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  const fallback = () => truncate(JSON.stringify(input, null, 2), 500);
  const name = toolName.toLowerCase();
  if (name === 'bash') return firstString(input, ['command']) ?? fallback();
  if (name === 'read' || name === 'edit' || name === 'write') {
    return firstString(input, ['path', 'file_path', 'notebook_path']) ?? fallback();
  }
  if (name === 'glob' || name === 'grep' || name === 'find' || name === 'ls') {
    return firstString(input, ['pattern', 'path', 'query']) ?? fallback();
  }
  return fallback();
}

/** 从工具入参里提取编辑前后的文本（兼容 pi/CC 两套键名） */
export function extractEditPair(input: Record<string, unknown>): { oldText: string; newText: string } | null {
  const oldText = firstString(input, ['old_string', 'oldText', 'old']);
  const newText = firstString(input, ['new_string', 'newText', 'new']);
  if (oldText === undefined || newText === undefined) return null;
  return { oldText, newText };
}
