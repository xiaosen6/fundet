/**
 * MessageNavRail —— Cindy 同名组件整套移植（Fundet 版，Cindy PR #830）。
 * ---------------------------------------------------------------------------
 * 聊天区左缘的「提问导航条」：每条用户提问一根短刻度，当前正在阅读的提问加深，
 * hover 显示「提问 + 回答摘要」预览卡，点击跳转到那一轮的顶部。
 *
 * 职责定义（设计推导起点）：长 agent 对话的意义单元是「轮次」（提问→回答），
 * 导航条同时承担 ①定位（当前项）②跳转（落点框住整轮）③识别（预览卡）。
 *
 * 显隐（活跃深、空闲浅，不完全隐没）：
 *   - 前提条件：真实提问 ≥ NAV_RAIL_MIN_ENTRIES 且内容列左侧留白足够
 *     （窄窗口 / 嵌入面板自然隐藏，绝不压在气泡上）；
 *   - 满足前提后**常驻但分两档**：滚动、鼠标滑到左缘、悬停刻度时全亮；
 *     静止阅读 NAV_RAIL_IDLE_HIDE_MS 后**减淡**为浅灰（完全淡出会让人忘记
 *     它的存在，减淡保留「地图在这」的心理暗示，阅读态噪音仍然很低）。
 *
 * 入口去重：导航条**完整覆盖导航**（出场且未截断）时，父级抑制右上角
 * 「跳到上一条提问」chip —— 同一个导航任务只保留一套入口（经
 * onNavCoverageChange 上报）。刻度被截断的超长会话里 chip 回归，截断区
 * 仍有导航可用。
 *
 * 几何职责分工：
 *   - 本组件只做 DOM 测量（scroll + ResizeObserver，rAF 节流）并渲染；
 *   - 判定与规划是纯函数，在 messageNavRailModel.ts，node 环境直接单测；
 *   - 点击后的跳转（含渲染窗口外目标的扩窗、落点计算）由 MessageStream 的
 *     onJump 承接，那边持有贴底跟随 / 虚拟化器等状态。
 *
 * Fundet 适配差异（相对 Cindy 原版）：
 *   - 无 i18n，文案直接写中文字面量（语义 = Cindy zh-CN 翻译键）；
 *   - Tooltip 用 @radix-ui/react-tooltip 原语（Fundet 已有该依赖），整条导轨
 *     共用一个 Provider（delayDuration 150 / skipDelayDuration 700 的连续悬停
 *     体验，刻度纵距 9px 竖划不闪断）；面色映射 Fundet token（标签 = 默认
 *     tooltip 面，预览卡 = popover 面 bg-card/text-primary）；
 *   - getEntryWindowSide：Cindy 的渲染窗口是「锚点→末尾」后缀切片，未挂载
 *     必在视口上方（topAt=null → -∞ 语义成立）；Fundet 是 TanStack 居中窗口，
 *     未挂载可能在视口**下方** —— 由父级提供条目相对窗口的方位，下方的未挂载
 *     条目喂 +∞，保证喂给纯模型的 top 序列单调；
 *   - 合成 wheel 重派带 bubbles:true：Fundet 的贴底解除挂在容器的 React
 *     onWheel 上（委托到 React 根），不冒泡的合成事件到不了那里。
 *
 * pending 态：点击后目标立即显示为当前项（乐观），平滑滚动落定（几何判定
 * 追上）或用户产生主动滚动意图（wheel / touch / 方向键）时回归几何真值；
 * 3s 安全兜底防「点完不动」卡住乐观态。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { cn } from '../../lib/cn';

import { useNavigationKeyListener } from './useNavigationKeyListener';
import {
  NAV_RAIL_ACTIVE_FUDGE_PX,
  NAV_RAIL_MIN_AVAIL_HEIGHT_PX,
  NAV_RAIL_MIN_ENTRIES,
  NAV_RAIL_RANGE_BOTTOM_EDGE_PX,
  hasNavRailRoom,
  pickActiveNavId,
  pickVisibleNavRange,
  planNavRailTicks,
  planNavRailTickWidth,
  planNavRailTickProgress,
  type NavRailEntry,
} from './messageNavRailModel';
import { forwardNavRailWheel } from './messageNavRailWheel';

// 乐观 pending 态的安全兜底时长。
const PENDING_SAFETY_MS = 3000;
// 静止这么久后减淡（不隐没）。
const NAV_RAIL_IDLE_HIDE_MS = 2000;
// 空闲档的整条不透明度。全亮 100% / 空闲减淡到这个值，保留「地图在这」的
// 存在感又不抢阅读注意力（Cindy 2026-07-28 实机验收定的档位）。
const NAV_RAIL_IDLE_OPACITY_CLASS = 'opacity-40';
// 鼠标滑进滚动容器左缘这么宽的区域时唤醒导航条（mousemove 探测，不放
// pointer-events 层，避免挡住从留白处起手的划选）。
const WAKE_GUTTER_PX = 48;
// 刻度带的上下保留：顶部对齐内容区上留白；底部让出悬浮 chip 的位置再 16px。
const RAIL_TOP_PX = 28;
const RAIL_BOTTOM_EXTRA_PX = 16;

// 标签类 tooltip（「更早还有 N 条」）= Fundet 默认 tooltip 面色（ui/Tooltip
// 同款）。入场用 animate-fade-in（纯 opacity，reduced-motion 白名单内）——
// 不能用 tooltip-in（带 translateX(-50%)，是居中气泡专用，会顶掉 Radix 的
// 定位变换）。
const LABEL_TOOLTIP_CLASSES =
  'animate-fade-in z-50 select-none rounded-lg border border-board bg-card px-2 py-1 text-center text-12 leading-[1.5] text-secondary shadow-[var(--shadow-menu)]';
// 内容预览卡 = popover 语义面（白底深字 / 暗色深面），多行正文可读性优先，
// 与标签两类面色不混（Cindy 同款决策：Cindy --popover/--popover-foreground/
// --border-default → Fundet bg-card/text-primary/border-board）。
const PREVIEW_CARD_CLASSES =
  'animate-fade-in z-50 max-w-[380px] select-none rounded-lg border border-board bg-card px-3 py-2 text-13 leading-snug text-primary shadow-[var(--shadow-menu)]';

export interface MessageNavRailProps {
  /** 已加载的全部真实提问（deriveNavRailEntries 产物，时间正序）。 */
  entries: NavRailEntry[];
  /** MessageStream 的滚动容器 ref，测量与锚点查询都以它为根。 */
  scrollRef: { readonly current: HTMLDivElement | null };
  /** 内容列 maxWidth（与 MessageStream 内容列的 max-w 同值）。 */
  contentMaxWidth: number;
  /** ResizeObserver 测量时读取最新宽度，避免把连续像素变化回灌给 React。 */
  getContentMaxWidth?: () => number;
  /** 底部输入 overlay 高度，刻度带避开这段（Fundet composer 在流外，传 0）。 */
  bottomOffset: number;
  /** 点击刻度 → 跳到该提问。目标可能在渲染窗口外，由父级扩窗后滚动。 */
  onJump: (clientId: string) => void;
  /**
   * 「导航条完整覆盖导航」变化上报（出场资格 && 刻度未截断）。父级用它做
   * 入口去重：覆盖时抑制「跳到上一条提问」chip；导航条缺席或截断了更早
   * 刻度时 chip 回归。与淡入淡出无关 —— chip 只在滚动时出现，而滚动一定
   * 会唤醒导航条，按覆盖态抑制即可，信号稳定不闪烁。
   */
  onNavCoverageChange?: (covers: boolean) => void;
  /** 切会话重置几何与 pending 态。 */
  resetKey?: string;
  /**
   * 条目 i 相对虚拟渲染窗口的方位（Fundet 虚拟化适配，见文件头注释）：
   * 'above' = 窗口外且必在视口上方（喂 -∞）；'below' = 窗口外且在视口下方
   * （喂 +∞）；null = 窗口内（走 DOM 实测）。不传时按 Cindy 后缀切片语义
   * 全部视为上方。
   */
  getEntryWindowSide?: (index: number) => 'above' | 'below' | null;
}

export function MessageNavRail({
  entries,
  scrollRef,
  contentMaxWidth,
  getContentMaxWidth,
  bottomOffset,
  onJump,
  onNavCoverageChange,
  resetKey,
  getEntryWindowSide,
}: MessageNavRailProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // 视口内可见轮次的范围（整段提亮，与「当前项加长」互补）。存 id 而非下标：
  // 测量与渲染之间 entries 可能已更新，按 id 回查最稳。
  const [visibleRange, setVisibleRange] = useState<{ startId: string; endId: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [scrubId, setScrubId] = useState<string | null>(null);
  const [hasRoom, setHasRoom] = useState(false);
  const [availHeight, setAvailHeight] = useState(0);
  // 淡入淡出：挂载即亮（给切进会话的用户一个初始定位），此后随活动唤醒。
  const [awake, setAwake] = useState(true);

  const rafRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const railRef = useRef<HTMLElement | null>(null);
  const scrubRef = useRef<{
    pointerId: number;
    startY: number;
    moved: boolean;
    lastJumpedIndex: number | null;
    button: HTMLButtonElement;
  } | null>(null);
  const suppressClickRef = useRef(false);
  // 容器左缘缓存，给高频 mousemove 的左缘唤醒判定用，免得每次事件都
  // getBoundingClientRect 强制布局读；measure（scroll/resize 都会触发）时刷新。
  const containerLeftRef = useRef(0);
  // 测量回调经 rAF 异步触发，entries 派生的 id 列表 / 布局参数用 ref 透传
  // 拿最新值，避免把大数组挂进依赖链让监听器反复重挂。id 列表按 entries
  // 引用缓存，长会话滚动的高频测量不逐帧重新分配数组；初值空占位，首次渲染
  // 即被下面的引用比较填充，不在每次 render 白算一遍。
  const measureIdsRef = useRef<{ source: readonly NavRailEntry[] | null; ids: string[] }>({
    source: null,
    ids: [],
  });
  if (measureIdsRef.current.source !== entries) {
    measureIdsRef.current = { source: entries, ids: entries.map((e) => e.id) };
  }
  const contentMaxWidthRef = useRef(contentMaxWidth);
  contentMaxWidthRef.current = contentMaxWidth;
  const getContentMaxWidthRef = useRef(getContentMaxWidth);
  getContentMaxWidthRef.current = getContentMaxWidth;
  const bottomOffsetRef = useRef(bottomOffset);
  bottomOffsetRef.current = bottomOffset;
  const getEntryWindowSideRef = useRef(getEntryWindowSide);
  getEntryWindowSideRef.current = getEntryWindowSide;

  // 切会话全部归零，防旧目标 / 旧乐观态残留；重新亮一次做初始定位。
  useEffect(() => {
    setActiveId(null);
    setVisibleRange(null);
    setPendingId(null);
    setHoveredId(null);
    setScrubId(null);
    scrubRef.current = null;
    setAwake(true);
  }, [resetKey]);

  // 唤醒 + 重排空闲淡出计时。悬停刻度期间不淡出（计时器到点重排）。
  const wake = useCallback(() => {
    setAwake((cur) => (cur ? cur : true));
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    const scheduleHide = () => {
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        if (hoveringRef.current) {
          scheduleHide();
          return;
        }
        setAwake(false);
      }, NAV_RAIL_IDLE_HIDE_MS);
    };
    scheduleHide();
  }, []);

  const measure = useCallback(() => {
    rafRef.current = null;
    const root = scrollRef.current;
    if (!root) return;
    const containerRect = root.getBoundingClientRect();
    containerLeftRef.current = containerRect.left;
    const liveContentMaxWidth = getContentMaxWidthRef.current?.() || contentMaxWidthRef.current;
    const roomOk = hasNavRailRoom(containerRect.width, liveContentMaxWidth);
    setHasRoom(roomOk);
    const avail = Math.max(
      0,
      containerRect.height - bottomOffsetRef.current - RAIL_TOP_PX - RAIL_BOTTOM_EXTRA_PX,
    );
    setAvailHeight(avail);
    const ids = measureIdsRef.current.ids;
    // 组件常驻挂载，不出场（条数不足 / 窄窗 / 矮视口）时跳过逐条锚点测量，
    // 短对话滚动不背 querySelector + 布局读的开销；room/avail 已更新，条件
    // 翻转时下一次测量自然恢复。
    if (ids.length < NAV_RAIL_MIN_ENTRIES || !roomOk || avail < NAV_RAIL_MIN_AVAIL_HEIGHT_PX) {
      setActiveId((cur) => (cur === null ? cur : null));
      setVisibleRange((cur) => (cur === null ? cur : null));
      return;
    }
    // 同一帧内 topAt 会被 active / range 两个判定反复调，缓存测量结果。
    // 窗口外条目按方位喂 ±∞（见 getEntryWindowSide），保证序列单调、二分成立。
    const topCache = new Map<number, number | null>();
    const topAt = (i: number): number | null => {
      const cached = topCache.get(i);
      if (cached !== undefined) return cached;
      let top: number | null;
      const side = getEntryWindowSideRef.current?.(i);
      if (side === 'below') {
        top = Number.POSITIVE_INFINITY;
      } else if (side === 'above') {
        top = null;
      } else {
        const el = root.querySelector(
          `[data-message-client-id="${CSS.escape(ids[i])}"]`,
        ) as HTMLElement | null;
        top = el ? el.getBoundingClientRect().top : null;
      }
      topCache.set(i, top);
      return top;
    };
    const next = pickActiveNavId(ids, containerRect.top + NAV_RAIL_ACTIVE_FUDGE_PX, topAt);
    setActiveId((cur) => (cur === next ? cur : next));
    // 有效视口 = 扣除容差后的边界：顶部与当前项共用同一条阈值线（空白余量
    // 不算「看见了上一轮」），底部留 8px 防露头即亮。语义见 pickVisibleNavRange。
    const range = pickVisibleNavRange(
      ids,
      containerRect.top + NAV_RAIL_ACTIVE_FUDGE_PX,
      containerRect.bottom - NAV_RAIL_RANGE_BOTTOM_EDGE_PX,
      topAt,
    );
    const nextRange = range ? { startId: ids[range.startIndex]!, endId: ids[range.endIndex]! } : null;
    setVisibleRange((cur) =>
      cur?.startId === nextRange?.startId && cur?.endId === nextRange?.endId ? cur : nextRange,
    );
  }, [scrollRef]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(measure);
    }
  }, [measure]);

  // 主动滚动意图（wheel / touch / 方向键）→ 放弃乐观 pending，回归几何真值。
  const dropPending = useCallback(() => {
    setPendingId((cur) => (cur === null ? cur : null));
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      wake();
      scheduleMeasure();
    };
    // 左缘唤醒走 mousemove 探测而不是铺一层 pointer-events 热区：
    // 留白区常被用来起手划选文本，热区会吃掉 mousedown。左缘坐标用
    // measure 缓存的值（窗口纯平移导致的极小误差可接受），不在高频事件里
    // 强制布局读。
    const onMouseMove = (e: MouseEvent) => {
      if (e.clientX - containerLeftRef.current <= WAKE_GUTTER_PX) {
        wake();
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('mousemove', onMouseMove, { passive: true });
    root.addEventListener('wheel', dropPending, { passive: true });
    root.addEventListener('touchstart', dropPending, { passive: true });
    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(root);
    // 初次同步：挂载后未滚动也能算出当前项与可用空间。
    scheduleMeasure();
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('mousemove', onMouseMove);
      root.removeEventListener('wheel', dropPending);
      root.removeEventListener('touchstart', dropPending);
      ro.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollRef, scheduleMeasure, dropPending, wake]);

  useNavigationKeyListener(dropPending);

  // 条目变化（新发消息）与喂进测量的布局 props 变化都要重算。bottomOffset /
  // contentMaxWidth 只经 ref 透传给 measure，不列进这里的话布局变化既不触发
  // 容器 resize 也不滚动，availHeight 与纵向出场门槛会停在旧值直到下次滚动。
  useEffect(() => {
    scheduleMeasure();
  }, [entries, bottomOffset, contentMaxWidth, getContentMaxWidth, scheduleMeasure]);

  // 挂载亮相的那次也要按空闲节奏淡出。
  useEffect(() => {
    wake();
  }, [wake, resetKey]);

  // 平滑滚动落定，几何判定追上乐观目标 → 乐观态使命完成，交还给几何。
  useEffect(() => {
    if (pendingId !== null && pendingId === activeId) {
      setPendingId(null);
    }
  }, [pendingId, activeId]);

  // 出场资格：条数、横向留白、纵向空间三道门槛。纵向门槛防极矮视口 /
  // 输入 overlay 占满高度时刻度溢出压到输入区。
  const eligible =
    entries.length >= NAV_RAIL_MIN_ENTRIES &&
    hasRoom &&
    availHeight >= NAV_RAIL_MIN_AVAIL_HEIGHT_PX;
  const plan = planNavRailTicks(entries.length, availHeight);
  // 覆盖态上报（入口去重用）；卸载时收回。截断时不算覆盖 —— 被截掉的
  // 早期区域没有刻度，chip 必须回归兜底。
  const railCoversNav = eligible && plan.hiddenCount === 0;
  useEffect(() => {
    onNavCoverageChange?.(railCoversNav);
  }, [railCoversNav, onNavCoverageChange]);
  useEffect(() => {
    return () => {
      onNavCoverageChange?.(false);
    };
  }, [onNavCoverageChange]);

  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  const handleTickClick = useCallback(
    (clientId: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setPendingId(clientId);
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        setPendingId(null);
      }, PENDING_SAFETY_MS);
      onJump(clientId);
    },
    [onJump],
  );

  const findScrubIndex = useCallback((clientY: number): number | null => {
    const rail = railRef.current;
    if (!rail) return null;
    let nearest: { index: number; distance: number } | null = null;
    const buttons = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-message-nav-index]'));
    for (const button of buttons) {
      const index = Number(button.dataset.messageNavIndex);
      if (!Number.isInteger(index)) continue;
      const rect = button.getBoundingClientRect();
      const distance = Math.abs(clientY - (rect.top + rect.height / 2));
      if (nearest === null || distance < nearest.distance) nearest = { index, distance };
    }
    return nearest?.index ?? null;
  }, []);

  const jumpToScrubIndex = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      setScrubId(entry.id);
      const scrub = scrubRef.current;
      if (scrub?.lastJumpedIndex === index) return;
      if (scrub) scrub.lastJumpedIndex = index;
      setPendingId(entry.id);
      if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        setPendingId(null);
      }, PENDING_SAFETY_MS);
      onJump(entry.id);
    },
    [entries, onJump],
  );

  const handleTickPointerDown = useCallback(
    (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      suppressClickRef.current = false;
      const button = event.currentTarget;
      scrubRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        moved: false,
        lastJumpedIndex: null,
        button,
      };
      setScrubId(entries[index]?.id ?? null);
      wake();
      button.setPointerCapture?.(event.pointerId);
    },
    [entries, wake],
  );

  const handleTickPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const scrub = scrubRef.current;
      if (!scrub || scrub.pointerId !== event.pointerId) return;
      if (!scrub.moved && Math.abs(event.clientY - scrub.startY) < 3) return;
      scrub.moved = true;
      const index = findScrubIndex(event.clientY);
      if (index !== null) jumpToScrubIndex(index);
    },
    [findScrubIndex, jumpToScrubIndex],
  );

  const finishScrub = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, suppressFollowUpClick: boolean) => {
      const scrub = scrubRef.current;
      if (!scrub || scrub.pointerId !== event.pointerId) return;
      if (scrub.button.hasPointerCapture?.(event.pointerId)) {
        scrub.button.releasePointerCapture?.(event.pointerId);
      }
      suppressClickRef.current = suppressFollowUpClick && scrub.moved;
      scrubRef.current = null;
      setScrubId(null);
    },
    [],
  );

  const handleTickMouseEnter = useCallback(() => {
    hoveringRef.current = true;
    wake();
  }, [wake]);
  const handleTickMouseLeave = useCallback(() => {
    hoveringRef.current = false;
  }, []);

  // 悬停刻度带时滚轮不能失灵：导航条是滚动容器的兄弟 overlay，刻度按钮
  // pointer-events-auto 会成为 wheel 目标、冒泡不经过滚动容器，浏览器不会
  // 替我们滚聊天区。补两件事，缺一不可：
  //   1. 先把 wheel **重派**给滚动容器 —— root 上挂着既有的 wheel 意图监听
  //      （本组件的 dropPending；MessageStream 的贴底跟随解除）。只补位移不补
  //      意图，贴底流式时在刻度带上滚会被 pin-to-bottom 拽回。合成事件
  //      untrusted、不产生默认滚动，与下一步不会双滚；先意图后位移，对齐原生
  //      「监听先于默认滚动」的时序。bubbles:true 是 Fundet 适配（贴底解除挂
  //      React onWheel，委托到 React 根，不冒泡到不了）。
  //   2. 再把增量转发成真实位移（见 messageNavRailWheel.ts）。产生的
  //      scroll 事件经 root 的 onScroll 走 wake + scheduleMeasure。
  const handleRailWheel = useCallback(
    (e: ReactWheelEvent<HTMLElement>) => {
      const root = scrollRef.current;
      if (!root) return;
      root.dispatchEvent(
        new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, bubbles: true }),
      );
      forwardNavRailWheel(root, e);
    },
    [scrollRef],
  );

  if (!eligible) return null;

  const shown = entries.slice(plan.startIndex);
  const displayActiveId = pendingId ?? activeId;
  // 可见范围 id → 下标（渲染时按 id 回查，测量与渲染间 entries 变更也不会
  // 错位）。单次遍历同时定位两端，滚动高频重渲下不扫两遍数组。
  let rangeStartIdx = -1;
  let rangeEndIdx = -1;
  if (visibleRange) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]!.id === visibleRange.startId) rangeStartIdx = i;
      if (entries[i]!.id === visibleRange.endId) {
        rangeEndIdx = i;
        if (rangeStartIdx >= 0) break;
      }
    }
  }
  // 空闲档只是减淡、仍然可见可点，指针事件常开（悬停刻度本身就会唤醒全亮）。
  const tickEvents = 'pointer-events-auto';

  return (
    <nav
      ref={railRef}
      aria-label="提问导航"
      // 容器不吃事件，只有刻度自身 pointer-events-auto（空闲减淡时也可点，
      // 见 tickEvents 注释），不挡左缘留白里的文字选择；justify-center 让
      // 刻度组在（避开底部的）带内垂直居中。
      className={cn(
        'pointer-events-none absolute inset-y-0 left-2 z-30 flex w-6 flex-col items-stretch justify-center',
        // 动效 token：不透明度变化属 fast 档（150ms）、ease-out 曲线。
        'transition-opacity duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]',
        awake ? 'opacity-100' : NAV_RAIL_IDLE_OPACITY_CLASS,
      )}
      style={{ paddingTop: RAIL_TOP_PX, paddingBottom: bottomOffset + RAIL_BOTTOM_EXTRA_PX }}
      // wheel 事件从 pointer-events-auto 的刻度冒泡到这里统一转发，
      // 「更早还有 N 条」占位刻度一并覆盖。
      onWheel={handleRailWheel}
    >
      {/*
       * 整条导轨共用一个 Provider（skipDelayDuration 是 Provider 级状态）：
       * 首次 hover 等 150ms，之后 700ms 内切到相邻刻度立即显示，竖向划过时
       * 预览卡只换内容、不中断 —— 刻度纵距只有 9px，逐刻度独立 Provider 会
       * 连续闪断。disableHoverableContent 对齐 Cindy 封装默认（纯文本内容，
       * 离开 trigger 立即关）。
       */}
      <Tooltip.Provider delayDuration={150} skipDelayDuration={700} disableHoverableContent>
        {plan.hiddenCount > 0 ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <div
                className={cn('flex items-center justify-center', tickEvents)}
                style={{ height: plan.pitchPx }}
                onMouseEnter={handleTickMouseEnter}
                onMouseLeave={handleTickMouseLeave}
              >
                <span aria-hidden="true" className="text-10 leading-none text-muted">
                  ⋯
                </span>
              </div>
            </Tooltip.Trigger>
            {/* 占位刻度是**标签**，用默认 tooltip 面色，与下面的内容预览卡
                两类不混。 */}
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={6} className={LABEL_TOOLTIP_CLASSES}>
                更早还有 {plan.hiddenCount} 条提问
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ) : null}
        {shown.map((entry, i) => {
          // 纯附件且无文件名的提问用计数文案兜底（模型层不碰文案）。
          const preview =
            entry.preview || (entry.attachmentsOnly ? `附件 ${entry.attachmentsOnly} 件` : '');
          const isActive = entry.id === displayActiveId;
          const fullIdx = plan.startIndex + i;
          const interactionId = scrubId ?? hoveredId;
          const interactionIndex =
            interactionId == null ? -1 : entries.findIndex((item) => item.id === interactionId);
          const interactionDistance =
            interactionIndex < 0 ? null : Math.abs(fullIdx - interactionIndex);
          // 该轮次的内容当前正显示在视口里 → 提亮「屏上内容高亮」；
          // 当前项在提亮之上再加长，两个信号分工：范围 = 在看什么，长刻度 = 读到哪。
          const inView = rangeStartIdx >= 0 && fullIdx >= rangeStartIdx && fullIdx <= rangeEndIdx;
          // 自动化提问是系统注入的重复性消息，用更短的刻度保留其导航入口，
          // 同时让手动提问成为更容易扫到的主节奏。当前项仍比普通自动刻度更长，
          // 保持点击跳转后的定位反馈。（Fundet auto- 会话不进桌面流，恒 false。）
          const tickWidthClass = planNavRailTickWidth({
            distance: interactionDistance,
            isActive,
            inView,
            isAutomation: entry.isAutomation,
          });
          const tickOpacityClass =
            interactionDistance === 0
              ? 'opacity-100'
              : interactionDistance !== null
                ? 'opacity-[0.65]'
                : isActive
                  ? 'opacity-90'
                  : 'opacity-[0.65]';
          const markerProgress = planNavRailTickProgress(interactionDistance);
          return (
            <Tooltip.Root key={entry.id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label={`跳转到第 ${plan.startIndex + i + 1} 条提问：${preview}`}
                  aria-current={isActive ? 'true' : undefined}
                  data-message-nav-automation={entry.isAutomation ? 'true' : undefined}
                  data-message-nav-index={fullIdx}
                  onClick={() => handleTickClick(entry.id)}
                  onMouseLeave={() => {
                    handleTickMouseLeave();
                    setHoveredId((current) => (current === entry.id ? null : current));
                  }}
                  onPointerEnter={() => {
                    setHoveredId(entry.id);
                    handleTickMouseEnter();
                  }}
                  onPointerDown={(event) => handleTickPointerDown(fullIdx, event)}
                  onPointerMove={handleTickPointerMove}
                  onPointerUp={(event) => finishScrub(event, true)}
                  onPointerCancel={(event) => finishScrub(event, false)}
                  onLostPointerCapture={(event) => finishScrub(event, false)}
                  onMouseEnter={() => {
                    setHoveredId(entry.id);
                    handleTickMouseEnter();
                  }}
                  // 命中区吃满整格纵距，刻度线本体只有 2px 高。焦点环用全局
                  // --focus-ring token，键盘 Tab 可见（纯 outline-none 会让
                  // 键盘用户丢焦点）。
                  className={cn(
                    'group flex w-full items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                    tickEvents,
                  )}
                  style={{ height: plan.pitchPx }}
                >
                  <span
                    className={cn(
                      // 动效 token：base 档（200ms）+ 尺寸插值用的 ease-move
                      // 曲线。过渡属性从 all 收窄到实际会变的两项。
                      'h-[2px] w-[26px] origin-left rounded-full',
                      'transition-[transform,background-color] duration-[var(--motion-base)]',
                      'ease-[var(--motion-ease-move)]',
                      tickWidthClass,
                      tickOpacityClass,
                      interactionDistance === 0 ||
                        (interactionDistance === null && (isActive || inView))
                        ? 'bg-primary'
                        : 'bg-secondary group-hover:bg-primary',
                    )}
                    style={{
                      transform: `scaleX(${0.2308 + 0.7692 * markerProgress})`,
                    }}
                  />
                </button>
              </Tooltip.Trigger>
              {/*
               * 预览卡 = 提问（加粗一行）+ 回答摘要（灰字，至多 3 行）。
               * 摘要是识别的主载体：大量提问是「继续 / 重来」式短指令，只靠
               * 提问认不出是哪一轮。回答未产生时只显示提问行。
               * 无预览文本时不渲染 Content —— 空内容不该冒出一个空卡。
               */}
              {preview ? (
                <Tooltip.Portal>
                  <Tooltip.Content side="right" sideOffset={6} className={PREVIEW_CARD_CLASSES}>
                    <span className="flex max-w-[344px] flex-col gap-1">
                      <span className="truncate text-13 font-medium">{preview}</span>
                      {entry.answerExcerpt ? (
                        // 摘要 = 主文字色 × 50% 透明度，不引新 token。半透明
                        // 文字经抗锯齿合成会比同亮度实心灰显得更亮，调整这个
                        // 数必须实机看效果（Cindy 验收定档）。
                        <span className="line-clamp-3 whitespace-normal break-normal text-13 leading-relaxed opacity-50">
                          {entry.answerExcerpt}
                        </span>
                      ) : null}
                    </span>
                  </Tooltip.Content>
                </Tooltip.Portal>
              ) : null}
            </Tooltip.Root>
          );
        })}
      </Tooltip.Provider>
    </nav>
  );
}
