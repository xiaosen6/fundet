/**
 * 消息导航器（对齐 Cindy minimap）纯逻辑：user 消息在右缘导航条上的位置分布 +
 * 当前高亮判定 + 预览文本。node --test 可直测；组件侧只做映射与挂载。
 */

/** user 消息条数达到该值才渲染导航器（短会话无需导航） */
export const MIN_NAVIGATOR_USERS = 5;

/** 视口相交判定的 epsilon（px）：边缘 1~4px 内的重叠不算可见 */
const VIEW_EPSILON_PX = 4;

export interface MinimapMark {
  /** 虚拟行 index（user 消息所在行） */
  index: number;
  /** 导航条上的垂直位置（百分比，0=顶 100=底） */
  topPercent: number;
}

/** 每条 user 消息的导航条位置：行序 / (总行数-1) 线性映射（首行 0、末行 100） */
export function minimapMarks(userIndexes: readonly number[], totalRows: number): MinimapMark[] {
  const denom = Math.max(totalRows - 1, 1);
  return userIndexes.map((index) => ({
    index,
    topPercent: Math.min(100, Math.max(0, (index / denom) * 100)),
  }));
}

export interface VirtualItemLike {
  index: number;
  start: number;
  end: number;
}

export interface VisibleIndexRange {
  first: number;
  last: number;
}

/** 从 virtualizer.getVirtualItems()（含 overscan 外扩）取真实与视口相交的行 index 范围 */
export function visibleIndexRange(
  items: readonly VirtualItemLike[],
  scrollTop: number,
  viewportHeight: number,
): VisibleIndexRange | null {
  const viewTop = scrollTop + VIEW_EPSILON_PX;
  const viewEnd = scrollTop + viewportHeight - VIEW_EPSILON_PX;
  let first: number | null = null;
  let last: number | null = null;
  for (const it of items) {
    if (first === null && it.end >= viewTop) first = it.index;
    if (it.start <= viewEnd) last = it.index;
    else break;
  }
  return first === null || last === null ? null : { first, last };
}

/**
 * 当前高亮：≤视口末行的最后一条 user 消息（视口内有多条取最后一条；视口落在
 * 两条 user 消息之间时取上方最近一条 = 正在读的那轮）。视口在首条 user 消息
 * 之前返回 null。
 */
export function activeUserMarkIndex(
  userIndexes: readonly number[],
  lastVisibleIndex: number,
): number | null {
  let active: number | null = null;
  for (const ui of userIndexes) {
    if (ui > lastVisibleIndex) break;
    active = ui;
  }
  return active;
}

/** 预览文本：首个非空行 trim 后截断（与「上一条提问」chip 同口径） */
export function navigatorPreview(text: string, maxLen = 60): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine.trim().slice(0, maxLen);
}
