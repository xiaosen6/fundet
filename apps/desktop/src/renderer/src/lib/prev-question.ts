/**
 * 「跳到上一条提问」chip 的下标口径（纯函数，node --test 直测）。
 *
 * 2026-11-24 修复：此前 userIndexes 在 grouped（分组条目）上编号，却拿去与
 * 虚拟化 rows 比较/跳转——rows 相对 grouped 会剔除 todo 行、插入产物卡/
 * 轮末改动卡/流式伪行，只要历史里出现这些行，跳转目标就整体偏移。
 * 正解：直接在 rows 上找 user 行的下标。
 */

export interface RowKindLike {
  kind: string;
}

/** rows 里所有 user 行的下标（升序） */
export function userRowIndexes(rows: readonly RowKindLike[]): number[] {
  const idx: number[] = [];
  rows.forEach((r, i) => {
    if (r.kind === 'user') idx.push(i);
  });
  return idx;
}

/**
 * 视口上方的最近一个 user 行下标。firstVisible 是虚拟列表首个真实相交行的
 * 下标；找不到（视口在首个提问之前）返回 -1。
 */
export function prevUserRowIndex(userIdx: readonly number[], firstVisible: number): number {
  let prev = -1;
  for (const ui of userIdx) {
    if (ui < firstVisible) prev = ui;
    else break;
  }
  return prev;
}
