/**
 * 终态思考卡收口：无 final/redacted 的思考项在 done/error/abort/closed 后也必须
 * 停止 running。保留原文与已有 duration；没有改变时返回原数组，避免额外重渲染。
 */
export function settleRunningThinking<T extends { kind: string; running?: boolean }>(items: readonly T[]): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== 'thinking' || item.running !== true) return item;
    changed = true;
    return { ...item, running: false };
  });
  return changed ? next : (items as T[]);
}
