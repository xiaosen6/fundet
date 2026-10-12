/**
 * todo 扩展结果解析与状态重放。
 * ---------------------------------------------------------------------------
 * pi 官方 todo 扩展两种输出：
 * - list 全量清单：`[x] #1: 文本` 多行（parseTodoList）
 * - 增量确认（模型实际最常用的形态，2026-10-12 用户会话实锤）：单行
 *   `Added todo #3: 生成 PPT` / `Todo #3 completed` / `uncompleted` /
 *   `Removed todo #3`
 * 增量形态此前解析不出 → 计划卡永远不出现。parseTodoUpdate + applyTodoUpdate
 * 把一串增量确认按序重放成清单状态；渲染层每个 todo 调用行携带「调用后的
 * 快照」（Cindy InlinePlanCard 时间线快照同语义）。纯函数，node --test 直测。
 */

export interface TodoEntry {
  id: number;
  text: string;
  done: boolean;
}

const TODO_LINE = /^\[([x ])\] #(\d+): (.*)$/;

/** 解析 todo list 全量输出；非清单文本（add/toggle 的单行确认等）返回 null */
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

export type TodoUpdate =
  | { kind: 'add'; id: number; text: string }
  | { kind: 'complete' | 'uncomplete' | 'remove'; id: number }
  | { kind: 'snapshot'; entries: TodoEntry[] };

const ADD_RE = /^Added todo #(\d+):\s*(.+)$/;
const DONE_RE = /^Todo #(\d+) (completed|uncompleted)$/;
const REMOVE_RE = /^(?:Removed|Deleted) todo #(\d+)$/;
const NOOP_RE = /^No todos?$/i;

/** 单条 todo 工具输出 → 增量更新；不认识返回 null（含 "No todos" 静默） */
export function parseTodoUpdate(resultText: string | undefined): TodoUpdate | null {
  if (!resultText) return null;
  const text = resultText.trim();
  if (!text) return null;
  // 多行且含清单行 → 全量快照
  if (text.includes('\n')) {
    const entries = parseTodoList(text);
    if (entries) return { kind: 'snapshot', entries };
    return null;
  }
  if (NOOP_RE.test(text)) return null;
  let m = ADD_RE.exec(text);
  if (m) return { kind: 'add', id: Number(m[1]), text: (m[2] ?? '').trim() };
  m = DONE_RE.exec(text);
  if (m) return { kind: m[2] === 'completed' ? 'complete' : 'uncomplete', id: Number(m[1]) };
  m = REMOVE_RE.exec(text);
  if (m) return { kind: 'remove', id: Number(m[1]) };
  // 单行也可能是只有一行的全量清单
  const entries = parseTodoList(text);
  return entries ? { kind: 'snapshot', entries } : null;
}

/** 按序重放一条更新，返回新状态（不可变；未命中 id 的 add 以原文兜底不抛错） */
export function applyTodoUpdate(state: readonly TodoEntry[], update: TodoUpdate): TodoEntry[] {
  switch (update.kind) {
    case 'snapshot':
      return update.entries.map((e) => ({ ...e }));
    case 'add':
      return [...state, { id: update.id, text: update.text, done: false }];
    case 'complete':
      return state.map((e) => (e.id === update.id ? { ...e, done: true } : e));
    case 'uncomplete':
      return state.map((e) => (e.id === update.id ? { ...e, done: false } : e));
    case 'remove':
      return state.filter((e) => e.id !== update.id);
  }
}

/**
 * 一串（按调用顺序的）todo 工具输出 → 各步调用后的清单快照序列。
 * 某步解析不出（无结果 / "No todos"）状态不变，快照沿用当前值。
 * 返回与输入等长的数组，方便渲染层逐行配对快照卡。
 */
export function replayTodoSnapshots(resultTexts: readonly (string | undefined)[]): TodoEntry[][] {
  let state: TodoEntry[] = [];
  const out: TodoEntry[][] = [];
  for (const text of resultTexts) {
    const update = parseTodoUpdate(text);
    if (update) state = applyTodoUpdate(state, update);
    out.push(state.map((e) => ({ ...e })));
  }
  return out;
}

/** 重放后的最新清单（右上角常驻计划卡的数据源）；从未建过计划返回 null */
export function latestTodoSnapshot(resultTexts: readonly (string | undefined)[]): TodoEntry[] | null {
  const snaps = replayTodoSnapshots(resultTexts);
  const last = snaps[snaps.length - 1];
  return last && last.length > 0 ? last : null;
}
