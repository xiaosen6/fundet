/**
 * messageNavRailModel —— Cindy 同名纯逻辑层整套移植（Fundet 版，Cindy PR #830）。
 * ---------------------------------------------------------------------------
 * MessageNavRail（左缘「提问导航条」）的纯逻辑：条目派生 / 当前提问判定 /
 * 空间与截断规划。全部为无 DOM 依赖的纯函数，node --test 直接单测。
 *
 * 组件侧（MessageNavRail.tsx）只负责测量与渲染：把 DOM 几何量喂进来，拿结果画。
 *
 * 与 Cindy 的适配差异：
 * - 条目派生输入从 Cindy ChatMessage 换成 Fundet DisplayItem；Fundet 无
 *   steer 插话 / 合成续跑 / 系统卡 / hook 消息封装，派生按「user 提问 → 其后
 *   最后一条非空 assistant 正文」收敛，语义与 Cindy 对普通消息一致；
 * - auto- 会话不进桌面消息流，isAutomation 恒缺省（组件仍保留短刻度支持）；
 * - Fundet 历史一次性全量加载（无 onLoadMore 分页），Cindy 的空闲补页
 *   shouldBackfillForNavRail 一族未移植。
 */

import type { DisplayItem } from '../../stores/sessionStore';

export interface NavRailEntry {
  /** user 消息的 id，同时是 data-message-client-id 锚点值。 */
  id: string;
  /**
   * scheduler 注入的自动化提问；导航条用更短的刻度与手动提问区分。
   * Fundet 的 auto- 会话不进桌面流，当前恒为缺省（false）。
   */
  isAutomation?: boolean;
  /**
   * 提问的单行预览。不是原文首行：划选引用会把被引用的回答以 `> ` 前缀拼进
   * 正文，派生优先取引用块之外用户自己的话（首个非 '>' 非空行）。
   */
  preview: string;
  /**
   * 纯附件且取不到任何文件名时 preview 为空、这里记附件数，组件用
   * 「附件 N 件」文案兜底渲染预览与 aria —— 纯附件提问是真实提问，必须有刻度。
   */
  attachmentsOnly?: number;
  /**
   * 该轮最终回答的摘要（已剥 Markdown 标记、压平空白、截断）。agent 对话里
   * 大量提问是「继续 / 不对，重来」这类不含识别信息的短指令，回答摘要才是
   * 用户认出「这根刻度是哪一轮」的主载体。回答尚未产生（流式中 / 被打断）时
   * 为 undefined，预览卡只显示提问行。
   */
  answerExcerpt?: string;
}

/**
 * 少于这个数量不出导航条。设计依据：少于 4 轮的对话通常一两屏内看完，
 * 「地图」没有价值；且用提问数（而非内容高度）做门槛，流式输出把回答撑长时
 * 门槛判定不抖动，导航条不会闪现/消失。
 */
export const NAV_RAIL_MIN_ENTRIES = 4;

/**
 * 点击刻度后，目标提问顶边停在滚动容器顶下方这么多像素。
 * 轮次跳转的目的是「重读这一轮」：视口应恰好框住 提问 → 回答，上一轮的
 * 尾巴一行都不该露。落点由跳转侧（MessageStream 的 onJump）手动计算。
 */
export const NAV_RAIL_JUMP_TOP_OFFSET_PX = 12;

/**
 * 「当前提问」阈值线距容器顶的偏移。必须大于 NAV_RAIL_JUMP_TOP_OFFSET_PX：
 * 跳转落定后目标自身恰好压线成为当前项，刻度加深不漂移到上一条。
 */
export const NAV_RAIL_ACTIVE_FUDGE_PX = 40;

/** 回答摘要的最大长度（预览卡 CSS 再做 3 行 clamp，这里只防超长字符串）。 */
export const NAV_RAIL_EXCERPT_MAX_CHARS = 200;

/**
 * 内容列左侧留白至少这么宽才有导航条的位置。
 * 组成：左缘留白 8px + 刻度触达区 24px + 与内容列的安全间距 12px。
 * 不够宽（窄窗口 / 嵌入式小面板）时整条隐藏，绝不压在气泡上。
 */
export const NAV_RAIL_MIN_GUTTER_PX = 44;

/** 每根刻度占用的纵向空间（2px 线 + 7px 间距）。Cindy 实测验收结论：9px 紧凑
 *  但单根可辨认；14px 被否（松散难看）。调整前先实机看效果再动。 */
export const NAV_RAIL_TICK_PITCH_PX = 9;
/** 空间不足时允许压缩到的最小纵距；再小刻度就粘连不可点了。 */
export const NAV_RAIL_TICK_MIN_PITCH_PX = 5;

/**
 * 刻度带可用高度低于这个值时导航条不出场（与横向留白门槛同级的纵向门槛）。
 * 极矮视口 / 输入 overlay 占满高度时，连出场门槛条数的刻度都摆不下，
 * 硬渲染会溢出压到输入区。取值 = 门槛条数 × 标准纵距。
 */
export const NAV_RAIL_MIN_AVAIL_HEIGHT_PX = NAV_RAIL_MIN_ENTRIES * NAV_RAIL_TICK_PITCH_PX;

/**
 * 从已加载的 items 派生导航条目（每条真实提问一根刻度）。
 *
 * 过滤规则：无可见文本也无附件的 user 行不当成提问；thinking / 工具组 /
 * error / notice / task 行不参与预览与摘要。回答摘要只属于最近一根可见刻度：
 * 一轮内取最后一条非空 assistant 正文（开工叙述被最终回答覆盖）；空白的
 * assistant 正文不占摘要名额。输入是全量已加载 items（导航条要覆盖整段历史，
 * 渲染窗口外的目标由跳转侧扩窗解决）。
 */
export function deriveNavRailEntries(items: readonly DisplayItem[]): NavRailEntry[] {
  const entries: NavRailEntry[] = [];
  let lastOwnsAnswers = false;
  let excerpt: string | null = null;

  const closeAnswerTurn = () => {
    const last = entries[entries.length - 1];
    if (last && excerpt) last.answerExcerpt = excerpt;
    excerpt = null;
    lastOwnsAnswers = false;
  };

  for (const m of items) {
    if (m.kind === 'user') {
      let preview = promptPreviewLine(m.text);
      const attachmentNames = (m.attachments ?? []).map((a) => a.name).filter(Boolean);
      if (!preview) preview = attachmentNames.join(' · ');
      const attachmentCount = m.attachments?.length ?? 0;
      if (preview) {
        closeAnswerTurn();
        entries.push({ id: m.id, preview });
        lastOwnsAnswers = true;
      } else if (attachmentCount > 0) {
        // 有附件但一个名字都取不到（无名附件）：仍是真实提问，保留刻度，
        // 预览文案由组件按 attachmentsOnly 兜底。
        closeAnswerTurn();
        entries.push({ id: m.id, preview: '', attachmentsOnly: attachmentCount });
        lastOwnsAnswers = true;
      } else {
        // 无文本、无附件 → 无法识别的空刻度，不当成提问。
        closeAnswerTurn();
      }
      continue;
    }
    if (!lastOwnsAnswers) continue;
    if (m.kind !== 'assistant') continue;
    const normalized = normalizeExcerpt(m.text);
    if (normalized) excerpt = normalized;
  }
  closeAnswerTurn();
  return entries;
}

/**
 * 提问（可见正文）→ 单行预览。优先取引用块（`> ` 前缀行）之外用户自己的话；
 * 全引用消息退回引用文字本身（去引用前缀）。
 */
export function promptPreviewLine(visibleText: string): string {
  const lines = visibleText.split('\n');
  const own = lines.find((line) => line.trim() && !line.trimStart().startsWith('>'));
  const anyLine = lines.find((line) => line.trim()) ?? '';
  return (own ?? anyLine).replace(/^\s*>\s?/, '').trim();
}

/**
 * 摘要净化：剥常见 Markdown 标记 → 压平空白成单行 → 截断到上限。
 * AI 回答几乎都是 Markdown，不剥标记的话预览卡里全是 `**` / 反引号 / 标题井号
 * 这类源码噪音。只做轻量文本级剥离（粗体星号 / 行内代码 / 标题与引用前缀 /
 * 无序列表符 / 链接留文字），不追求完整 Markdown 解析 —— 预览要的是可扫读，
 * 不是保真渲染。下划线不动（文件名 / 标识符里是正文）。
 * 全空白返回空串（调用方按 falsy 丢弃）。
 */
export function normalizeExcerpt(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '') // HTML 注释
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接/图片留文字
    .replace(/^#{1,6}\s+/gm, '') // 标题前缀
    .replace(/^>\s?/gm, '') // 引用前缀
    .replace(/^[-+]\s+/gm, '') // 无序列表符（星号由下一条统一剥）
    .replace(/[*`]/g, '') // 粗体/斜体星号、行内代码反引号
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAV_RAIL_EXCERPT_MAX_CHARS);
}

/**
 * 判定「当前提问」：视口顶端正在阅读的内容归属于哪条提问。
 *
 * 语义 = 最后一条「顶边已越过视口顶部阈值线」的提问（它的回答正被阅读）。
 * 全部都还在阈值线之下（视口停在对话最顶端）时，当前提问 = 第一条。
 *
 * @param topAt 取第 i 条的顶边位置（getBoundingClientRect().top）。
 *   `null` = 该消息在渲染窗口外未挂载、且必在视口上方 —— 视作「已越过阈值」。
 *   视口下方的未挂载条目由调用方喂 Number.POSITIVE_INFINITY（见 MessageNavRail
 *   的 getEntryWindowSide 适配注释）。
 * @param thresholdTop 视口顶部阈值线（容器 top + fudge）。fudge 要盖过跳转
 *   落点偏移，跳转落定后目标自身恰好压线变为当前项。
 */
export function pickActiveNavId(
  ids: ReadonlyArray<string>,
  thresholdTop: number,
  topAt: (index: number) => number | null,
): string | null {
  if (ids.length === 0) return null;
  const idx = lastIndexAtOrBelow(ids.length, thresholdTop, topAt, true);
  return idx >= 0 ? ids[idx] : ids[0];
}

/**
 * 二分查找「最后一个顶边不超过 limit 的条目下标」（找不到返回 -1）。
 *
 * 前提：tops 随文档序单调不减（未挂载上方 = -∞ 只出现在序列前缀、未挂载下方
 * = +∞ 只出现在后缀，Fundet 虚拟窗口语义由调用方保证，见 MessageNavRail）。
 * 每次 topAt 可能是一次 querySelector + getBoundingClientRect 强制布局读，
 * 且判定在 rAF 里逐帧跑 —— 线性反向扫描在「滚动到长会话历史顶部」场景下每帧
 * 要测几百个锚点，二分降到 O(log n)。
 */
function lastIndexAtOrBelow(
  count: number,
  limit: number,
  topAt: (index: number) => number | null,
  inclusive: boolean,
): number {
  let lo = 0;
  let hi = count - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = topAt(mid) ?? Number.NEGATIVE_INFINITY;
    if (inclusive ? top <= limit : top < limit) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 范围判定的底部容差：轮次顶边至少要探进视口底这么多像素才算可见。 */
export const NAV_RAIL_RANGE_BOTTOM_EDGE_PX = 8;

export interface NavRailVisibleRange {
  /** 视口内首个可见轮次的条目下标（含）。 */
  startIndex: number;
  /** 视口内最后一个可见轮次的条目下标（含）。 */
  endIndex: number;
}

/**
 * 判定「当前视口正显示着哪些轮次」（整段高亮用，与单一「当前项」互补：
 * 当前项 = 阅读锚点，加长；可见范围 = 屏上内容的归属轮次，提亮）。
 *
 * 轮次 i 的内容区间 = [top_i, top_{i+1})；最后一轮延伸到无穷。与
 * [viewTop, viewBottom) 相交即可见。
 *
 * 边界语义：调用方传入的应是**有效视口**，即已经扣除容差的边界 ——
 * 顶部与「当前项」共用 NAV_RAIL_ACTIVE_FUDGE_PX（视口顶部的几十像素往往
 * 是上一轮的收尾空白：消息间距 + 跳转落点偏移，一行内容都没露，严格几何
 * 相交会把上一轮误点亮）；底部扣 NAV_RAIL_RANGE_BOTTOM_EDGE_PX 防 1 像素
 * 露头就点亮。顶部与当前项共线的推论：当前项恒等于亮带首项，加长与提亮
 * 两个信号永不打架。
 *
 * 视口整体在第一条提问之前（还没有任何轮次开始）时返回 null。
 */
export function pickVisibleNavRange(
  ids: ReadonlyArray<string>,
  viewTop: number,
  viewBottom: number,
  topAt: (index: number) => number | null,
): NavRailVisibleRange | null {
  const n = ids.length;
  if (n === 0) return null;
  // 末端：最后一个「轮次起点已进入视口底之上」的条目。
  const endIndex = lastIndexAtOrBelow(n, viewBottom, topAt, false);
  if (endIndex < 0) return null;
  // 起端：最后一个「顶边仍在视口顶之上（含压线）」的条目 —— 它以及它之后
  // 到 endIndex 的轮次都有内容落在视口里；不存在时视口从第一条开始。
  const startIndex = Math.min(endIndex, Math.max(0, lastIndexAtOrBelow(n, viewTop, topAt, true)));
  return { startIndex, endIndex };
}

export interface NavRailPlan {
  /** 从这个下标开始渲染（之前的条目被截断，只保留最近的一段）。 */
  startIndex: number;
  /** 实际采用的纵距（px/根）。 */
  pitchPx: number;
  /** 被截掉的更早条目数；>0 时组件渲染「更早还有 N 条」占位刻度。 */
  hiddenCount: number;
}

/**
 * 纵向空间规划：先压缩间距，还放不下就截断只保留最近的一段。
 * 截断时预留一根刻度的位置给「更早还有 N 条」占位。
 */
export function planNavRailTicks(entryCount: number, availableHeightPx: number): NavRailPlan {
  if (entryCount <= 0 || availableHeightPx <= 0) {
    return { startIndex: 0, pitchPx: NAV_RAIL_TICK_PITCH_PX, hiddenCount: 0 };
  }
  if (entryCount * NAV_RAIL_TICK_PITCH_PX <= availableHeightPx) {
    return { startIndex: 0, pitchPx: NAV_RAIL_TICK_PITCH_PX, hiddenCount: 0 };
  }
  const compressed = Math.floor(availableHeightPx / entryCount);
  if (compressed >= NAV_RAIL_TICK_MIN_PITCH_PX) {
    return { startIndex: 0, pitchPx: compressed, hiddenCount: 0 };
  }
  // 最小纵距也放不下：截断。留一格给「更早还有 N 条」占位刻度。
  const slots = Math.max(2, Math.floor(availableHeightPx / NAV_RAIL_TICK_MIN_PITCH_PX));
  const shown = Math.min(entryCount, slots - 1);
  return {
    startIndex: entryCount - shown,
    pitchPx: NAV_RAIL_TICK_MIN_PITCH_PX,
    hiddenCount: entryCount - shown,
  };
}

/**
 * 计算刻度线宽度。悬浮或 scrub 时，以目标为中心向两侧逐级收缩 1～3 根；
 * 当前阅读位置仍保留自己的加长反馈，避免交互态覆盖阅读态。
 * 所有状态共享同一条 26px 轨道；hover/scrub 的渐进伸缩由渲染层的 scaleX
 * 负责，避免普通态出现不一致的横条长度。
 */
export function planNavRailTickWidth(input: {
  distance: number | null;
  isActive: boolean;
  inView: boolean;
  isAutomation?: boolean;
}): string {
  void input;
  return 'w-[26px]';
}

export function planNavRailTickProgress(distance: number | null): number {
  if (distance === null) return 0;
  if (distance === 0) return 1;
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  if (distance === 3) return 0.2;
  return 0;
}

/**
 * 导航条是否有横向空间：内容列（maxWidth 截断后）左侧的实际留白够不够。
 * 内容列由 mx-auto 居中，留白 = (容器宽 - 内容实际宽) / 2。
 */
export function hasNavRailRoom(containerWidthPx: number, contentMaxWidthPx: number): boolean {
  if (containerWidthPx <= 0) return false;
  const contentWidth = Math.min(containerWidthPx, contentMaxWidthPx);
  return (containerWidthPx - contentWidth) / 2 >= NAV_RAIL_MIN_GUTTER_PX;
}
