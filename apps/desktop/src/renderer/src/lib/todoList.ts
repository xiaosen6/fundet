/**
 * todo 扩展结果解析（官方 examples/extensions/todo.ts 的 list 输出格式：
 * `[x] #1: 文本` / `[ ] #2: 文本`，多行）。纯函数，node --test 可直测。
 */

export interface TodoEntry {
  id: number;
  text: string;
  done: boolean;
}

const TODO_LINE = /^\[([x ])\] #(\d+): (.*)$/;

/** 解析 todo list 输出；非清单文本（add/toggle 的单行确认等）返回 null */
export function parseTodoList(resultText: string | undefined): TodoEntry[] | null {
  if (!resultText) return null;
  const lines = resultText.split('\n').map((l) => l.trim());
  const entries: TodoEntry[] = [];
  for (const line of lines) {
    const m = TODO_LINE.exec(line);
    if (!m) continue;
    const id = Number(m[2]);
    if (!Number.isFinite(id)) continue;
    entries.push({ id, text: m[3] ?? '', done: m[1] === 'x' });
  }
  // 至少 1 行可解析才算清单（"No todos" 等返回 null 走普通工具卡）
  return entries.length > 0 ? entries : null;
}
