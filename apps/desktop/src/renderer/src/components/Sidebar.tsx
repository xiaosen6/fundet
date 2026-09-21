/**
 * Sidebar —— 会话列表（按更新时间倒序，由 main 查询保证）+ 新建会话 + 删除 + 设置入口。
 *
 * 视觉复刻 Cindy 侧栏（真机参照 ref-shots/cindy-02/08，CINDY skin）：
 * - 整块 Surface 平铺，只靠右侧 1px Board 发丝线与主区分隔（无背景色分块、无阴影）。
 * - 顶行品牌位：图形 logo + LongMa 字；其下是同级等权 pill 导航行
 *   （h-8 / rounded-full / px-3 / gap-2.5 / text-14，icon 15×1.8）。
 * - 会话区：小字灰标签「会话」+ 会话行（SessionItem 解剖：32px pill 行，15px 状态槽
 *   + 标题 truncate + 右侧时间槽，hover 时 120ms 让位给重命名/删除按钮）。
 * - 选中行 = 反相胶囊（CINDY 反相中性：--accent 底 + --accent-fg 字，无描边）。
 * - 运行中会话：状态槽换 Thinking Orange 呼吸点。
 * - 底部：设置入口做成「用户胶囊」同款（icon 圆 + 文字的 pill 卡，对齐 Cindy
 *   UserInfoSection 的 Not-signed-in 胶囊位）。
 */
import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Bot, Briefcase, CalendarClock, CirclePlus, MessageSquare, Pencil, Pin, PinOff, Search, Trash2, UserRound, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SessionListItem, SessionSearchHit } from '../../../shared/fundet-api.js';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { getProfile, subscribeProfile } from '../lib/profile';
import { reorderSessions, setSessionPinned, useSessionAttentionMap } from '../stores/sessionStore';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { BrandMark } from './BrandMark';
import { SessionRenameInput } from './SessionRenameInput';
import { Tooltip } from './ui/Tooltip';
import { type SidebarPanelId } from './sidebar/SidebarPanelDrawer';

interface SidebarProps {
  sessions: SessionListItem[];
  activeId: string | null;
  /** 各会话是否有后台 turn 在跑（呼吸点提示） */
  runningIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  showNewHint?: boolean;
  width?: number;
  /** 拖拽条按下时回调（renderer 侧管理拖拽逻辑） */
  onResizeStart?: (e: React.PointerEvent) => void;
  /** 当前打开的主区面板（右侧就地显示，null = 会话视图） */
  activePanel?: SidebarPanelId | null;
  /** 打开/关闭面板（null = 返回会话）；再点同款 = 关闭 */
  onOpenPanel?: (id: SidebarPanelId | null) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 导航行通用样式 —— 各行同款 pill 行（对齐 Cindy SidebarTopNav ROW_CLASS） */
const NAV_ROW_CLASS =
  'flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-14 font-normal text-primary transition-colors hover:bg-hover select-none cursor-pointer';

const ACTION_BTN =
  'flex h-6 w-6 items-center justify-center rounded-full transition-opacity duration-[var(--motion-fast)]';

/** 超长会话列表的增量窗口（对齐 MessageStream 列表窗口化思路）：
 * 首窗渲染最近 60 条（侧栏一屏约 20 行），触底 sentinel 再扩 80 条。 */
const LIST_INITIAL = 60;
const LIST_EXTEND = 80;

/** 左上能力入口（独立抽屉面板，不再跳设置页）。MCP 服务器 0.2.29 起移回设置页（用户拍板）。 */
const PANEL_BUTTONS: Array<{ id: SidebarPanelId; label: string; Icon: typeof Bot }> = [
  { id: 'im', label: 'IM 机器人', Icon: Bot },
  { id: 'automations', label: '自动化', Icon: CalendarClock },
  { id: 'dws', label: '钉钉工作台', Icon: Briefcase },
  { id: 'skills', label: '技能', Icon: Zap },
  { id: 'knowledge', label: '知识库', Icon: BookOpen },
];

/** 会话行标题：真溢出时 hover 播一次匀速阅读滚动（Cindy SidebarTitleMarquee
 * 语义窄例外：每可视宽 2.4s、300ms 起播延迟、离开立即复位回省略号头；
 * reduced-motion 保持省略号 + 原生 title 提示）。 */
function MarqueeTitle({ text }: { text: string }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState<number | null>(null);

  const stop = useCallback((): void => setShift(null), []);
  const start = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    setShift(overflow > 1 ? overflow : null);
  }, []);

  return (
    <span
      ref={containerRef}
      className="min-w-0 flex-1 truncate"
      title={reducedMotion ? text : undefined}
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      {shift !== null && !reducedMotion ? (
        <span
          className="marquee-track inline-block"
          style={{
            '--marquee-shift': `${shift}px`,
            '--marquee-duration': `${Math.max(1, Math.ceil(shift / Math.max(1, containerRef.current?.clientWidth ?? 1))) * 2400}ms`,
          } as React.CSSProperties}
        >
          {text}
        </span>
      ) : (
        text
      )}
    </span>
  );
}

interface SessionRowProps {
  session: SessionListItem;
  isActive: boolean;
  isRunning: boolean;
  /** 关注态：turn 非注视下完成（绿）/ 终态出错（红）；注视即清 */
  attention: 'done' | 'error' | null;
  /** 拖拽排序进行中（本行是拖拽源）：降透明度 */
  isDragging?: boolean;
  /** 置顶行可拖拽换序 */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** 置顶/取消置顶（草稿不显示入口） */
  onSetPinned?: (pinned: boolean) => void;
}

const SessionRow = forwardRef<HTMLDivElement, SessionRowProps>(function SessionRow(
  {
    session,
    isActive,
    isRunning,
    attention,
    isDragging = false,
    draggable = false,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onSelect,
    onDelete,
    onRename,
    onSetPinned,
  },
  ref,
): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const committed = useRef(false);
  const display = session.title || session.model || session.id.slice(0, 8);

  // 运行 → 空闲的跳变：非选中行播一次 settle 底色闪烁（0.9s，低调的「完成了」）
  const wasRunning = useRef(isRunning);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    const transitioned = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (!transitioned) return;
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 1000);
    return () => clearTimeout(t);
  }, [isRunning]);

  const startEdit = (): void => {
    committed.current = false;
    setDraft(session.title || display);
    setEditing(true);
  };

  const cancel = (): void => {
    committed.current = true;
    setEditing(false);
  };

  const commit = (raw: string): void => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed === session.title) return;
    void onRename(session.id, trimmed);
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      draggable={draggable && !editing}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (!editing) onSelect(session.id);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startEdit();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
      className={cn(
        'group relative flex h-8 w-full items-center gap-2.5 rounded-full pr-2 pl-3',
        'text-left text-14 font-medium select-none',
        isActive
          ? 'cursor-pointer bg-accent text-accent-fg'
          : 'cursor-pointer text-primary hover:bg-hover',
        settling && !isActive && 'session-settle',
        isDragging && 'opacity-40',
      )}
    >
      <span className="flex w-[15px] shrink-0 items-center justify-center">
        {isRunning ? (
          <span className="h-2 w-2 animate-fundet-pulse rounded-full bg-warning" />
        ) : attention === 'error' ? (
          <span className="h-2 w-2 rounded-full bg-error" />
        ) : attention === 'done' ? (
          <span className="session-dot-pulse relative h-2 w-2 rounded-full bg-success" />
        ) : (
          <MessageSquare
            size={12}
            strokeWidth={1.8}
            className={isActive ? 'text-accent-fg' : 'text-muted'}
          />
        )}
      </span>
      {/* 运行中非选中行：底部短条扫动（活动感；选中行由反相胶囊自身表达） */}
      {isRunning && !isActive && <span aria-hidden className="session-sweep" />}

      {editing ? (
        <SessionRenameInput
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
        />
      ) : (
        <MarqueeTitle text={display} />
      )}

      {!editing && (
        <div className="group/slot relative ml-auto flex h-6 min-w-12 shrink-0 items-center justify-end">
          <time
            className={cn(
              'text-12 font-medium tabular-nums transition-opacity duration-[var(--motion-fast)]',
              'group-hover:opacity-0 group-focus-within/slot:opacity-0',
              isActive ? 'text-accent-fg opacity-80' : 'text-muted',
            )}
          >
            {formatTime(session.updatedAt)}
          </time>
          <div
            className={cn(
              'absolute top-0 right-0 flex h-6 items-center',
              'transition-opacity duration-[var(--motion-fast)]',
              'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
              'group-focus-within/slot:pointer-events-auto group-focus-within/slot:opacity-100',
            )}
          >
            {onSetPinned && (
              <Tooltip label={session.pinned ? '取消置顶' : '置顶'} side="bottom">
                <button
                  type="button"
                  className={cn(
                    ACTION_BTN,
                    isActive ? 'text-accent-fg hover:opacity-70' : 'text-muted hover:text-primary',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetPinned(!session.pinned);
                  }}
                >
                  {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              </Tooltip>
            )}
            <Tooltip label="重命名" side="bottom">
              <button
                type="button"
                className={cn(ACTION_BTN, isActive ? 'text-accent-fg hover:opacity-70' : 'text-muted hover:text-primary')}
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
              >
                <Pencil size={13} />
              </button>
            </Tooltip>
            <Tooltip label="删除会话" side="bottom">
              <button
                type="button"
                className={cn(ACTION_BTN, isActive ? 'text-accent-fg hover:opacity-70' : 'text-muted hover:text-error')}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
});

export function Sidebar({
  sessions,
  activeId,
  runningIds,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  showNewHint,
  width = 260,
  onResizeStart,
  activePanel = null,
  onOpenPanel,
}: SidebarProps): React.JSX.Element {
  const profile = useSyncExternalStore(subscribeProfile, getProfile, getProfile);
  const attentionMap = useSessionAttentionMap();
  const reducedMotion = useReducedMotion();

  // ---- 会话搜索（标题 + 正文 FTS5；200ms 防抖） ----
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SessionSearchHit[] | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return undefined;
    }
    const t = setTimeout(() => {
      window.fundet
        .searchSessions(q)
        .then((hits) => setSearchResults(hits))
        .catch(() => setSearchResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // 置顶段拖拽：本地顺序覆盖（服务端权威序到达后清空）
  const [dragId, setDragId] = useState<string | null>(null);
  const [pinnedOrder, setPinnedOrder] = useState<string[] | null>(null);
  const draggingRef = useRef(false);

  const ordered = useMemo(() => {
    if (!pinnedOrder) return sessions;
    const rank = new Map(pinnedOrder.map((id, i) => [id, i]));
    const pinned = sessions
      .filter((s) => s.pinned)
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [...pinned, ...sessions.filter((s) => !s.pinned)];
  }, [sessions, pinnedOrder]);

  // 服务端序刷新（非拖拽中）即视为权威，清本地覆盖
  useEffect(() => {
    if (!draggingRef.current) setPinnedOrder(null);
  }, [sessions]);

  // 会话列表窗口化：limit 随滚动单调增长；activeId 落到窗口外时扩到覆盖
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [limit, setLimit] = useState(LIST_INITIAL);
  const activeIndex = activeId ? ordered.findIndex((s) => s.id === activeId) : -1;
  useEffect(() => {
    if (activeIndex >= limit) setLimit(activeIndex + 1);
  }, [activeIndex, limit]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((v) => (v < ordered.length ? v + LIST_EXTEND : v));
        }
      },
      { root: listRef.current, rootMargin: '200px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [ordered.length]);
  const visible = ordered.slice(0, Math.min(limit, ordered.length));
  const hasPinned = ordered.some((s) => s.pinned);

  // ---- FLIP 重排动画（Cindy List reorder 原型：transform 位移，非位移属性禁动） ----
  // 行元素按 id 登记；paint 后快照 offsetTop（布局稳定，不受滚动影响），
  // 下次渲染若位置变了 → 从旧位 translateY 到新位。
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const rowTops = useRef(new Map<string, number>());
  const orderKey = visible.map((s) => s.id).join('\u0000');
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const rafs: number[] = [];
    for (const [id, el] of rowEls.current) {
      const old = rowTops.current.get(id);
      if (old === undefined) continue;
      const dy = old - el.offsetTop;
      if (Math.abs(dy) < 2) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      rafs.push(
        requestAnimationFrame(() => {
          el.style.transition = 'transform var(--motion-base) var(--motion-ease-move)';
          el.style.transform = '';
        }),
      );
    }
    return () => {
      for (const r of rafs) cancelAnimationFrame(r);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, reducedMotion]);
  useEffect(() => {
    const next = new Map<string, number>();
    for (const [id, el] of rowEls.current) next.set(id, el.offsetTop);
    rowTops.current = next;
  });
  const registerRow = useCallback((id: string, el: HTMLDivElement | null): void => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  // ---- 拖拽换位（仅置顶段；dragenter 即活换序，FLIP 负责动画，dragend 持久化） ----
  const swapPinned = useCallback(
    (targetId: string): void => {
      if (!dragId || targetId === dragId) return;
      const pinnedIds = ordered.filter((s) => s.pinned).map((s) => s.id);
      const from = pinnedIds.indexOf(dragId);
      const to = pinnedIds.indexOf(targetId);
      if (from < 0 || to < 0) return;
      const next = [...pinnedIds];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      setPinnedOrder(next);
    },
    [dragId, ordered],
  );
  const endDrag = useCallback((): void => {
    draggingRef.current = false;
    setDragId(null);
    const order = pinnedOrder;
    if (order && order.length > 1) void reorderSessions(order);
  }, [pinnedOrder]);

  return (
    <aside
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-board bg-surface"
      style={{ width }}
    >
      <div
        className="absolute top-0 right-0 z-30 h-full w-[3px] cursor-col-resize hover:bg-accent/40"
        onPointerDown={onResizeStart}
      />
      {/* 顶行：图形 logo + 字标 */}
      <div className="drag-region flex h-[46px] shrink-0 items-center gap-2 px-4">
        <BrandMark size={22} />
        <span className="text-15 font-medium tracking-tight text-primary select-none">
          {brand.name}
        </span>
      </div>

      {/* 顶部常驻动作行：四个能力入口（主区右侧就地显示面板）+ 新对话 */}
      <div className="flex flex-col gap-0.5 px-3 pt-1 pb-2.5">
        {PANEL_BUTTONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpenPanel?.(activePanel === id ? null : id)}
            aria-pressed={activePanel === id}
            className={cn(NAV_ROW_CLASS, activePanel === id ? 'bg-hover font-medium' : '')}
          >
            <Icon
              size={15}
              strokeWidth={1.8}
              className={cn('shrink-0', activePanel === id ? 'text-primary' : 'text-muted')}
            />
            <span className="leading-none">{label}</span>
          </button>
        ))}
        <div className="group/new relative">
          <button
            type="button"
            onClick={onCreate}
            aria-label="新对话"
            data-sidebar-action="new-chat"
            className={NAV_ROW_CLASS}
          >
            <CirclePlus size={15} strokeWidth={1.8} className="shrink-0 text-muted" />
            <span className="leading-none">新对话</span>
          </button>
          {showNewHint ? (
            <div className="absolute top-1/2 left-full z-30 ml-3 w-[210px] -translate-y-1/2 rounded-container border border-board bg-card px-3 py-2.5 shadow-[var(--shadow-menu)]">
              <div className="absolute top-1/2 left-[-5px] h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-board bg-card" />
              <p className="text-13 font-medium text-primary">开启新对话</p>
              <p className="mt-0.5 text-12 leading-snug text-muted">
                点击后开始。发送第一条消息前不会出现在会话列表。
              </p>
            </div>
          ) : (
            <div className="pointer-events-none absolute top-1/2 left-full z-30 ml-3 hidden w-[210px] -translate-y-1/2 rounded-container border border-board bg-card px-3 py-2.5 shadow-[var(--shadow-menu)] group-hover/new:block">
              <div className="absolute top-1/2 left-[-5px] h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-board bg-card" />
              <p className="text-13 font-medium text-primary">开启新对话</p>
              <p className="mt-0.5 text-12 leading-snug text-muted">
                开始一次全新对话。发送消息前不会出现在会话列表。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 会话搜索：标题 + 正文 FTS5；输入即搜（200ms 防抖），Esc/清空恢复列表 */}
      <div className="px-3 pb-1.5">
        <div className="flex h-8 items-center gap-2 rounded-full border border-board bg-card px-3">
          <Search size={13} className="shrink-0 text-muted" strokeWidth={1.8} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setQuery('');
              }
            }}
            placeholder="搜索会话…"
            className="min-w-0 flex-1 bg-transparent text-13 text-primary outline-none placeholder:text-placeholder"
          />
          {query && (
            <button
              type="button"
              title="清空"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
              onClick={() => setQuery('')}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* 会话区（对齐 Cindy 的「Chat」段标；有置顶段时拆成 置顶/会话 两段标） */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
        {query.trim() ? (
          <>
            <div className="px-3 pt-1 pb-1 text-13 text-muted select-none">
              {searchResults === null ? '搜索中…' : `命中 ${searchResults.length} 个会话`}
            </div>
            {searchResults?.map((hit) => (
              <button
                key={hit.sessionId}
                type="button"
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-inner px-3 py-2 text-left transition-colors',
                  hit.sessionId === activeId ? 'bg-hover' : 'hover:bg-hover-soft',
                )}
                onClick={() => {
                  setQuery('');
                  onSelect(hit.sessionId);
                }}
              >
                <span className="min-w-0 truncate text-13 font-medium text-primary">
                  {hit.title || hit.sessionId.slice(0, 8)}
                </span>
                {hit.snippet && (
                  <span className="line-clamp-2 min-w-0 text-11 leading-snug text-muted">
                    {hit.snippet}
                  </span>
                )}
              </button>
            ))}
          </>
        ) : (
          <>
            {hasPinned ? (
              <div className="px-3 pt-1 pb-1 text-13 text-muted select-none">置顶</div>
            ) : (
              <div className="px-3 pt-1 pb-1 text-13 text-muted select-none">会话</div>
            )}
            {ordered.length === 0 && (
              <div className="px-3 pt-1 text-13 text-muted select-none">还没有会话</div>
            )}
            {visible.map((s, i) => (
              <Fragment key={s.id}>
                {hasPinned && !s.pinned && !visible[i - 1]?.pinned && (
                  <div className="mt-2 px-3 pt-1 pb-1 text-13 text-muted select-none">会话</div>
                )}
                <SessionRow
                  ref={(el) => registerRow(s.id, el)}
                  session={s}
                  isActive={s.id === activeId}
                  isRunning={runningIds.has(s.id)}
                  attention={attentionMap.get(s.id) ?? null}
                  isDragging={dragId === s.id}
                  draggable={Boolean(s.pinned)}
                  onDragStart={
                    s.pinned
                      ? (e) => {
                          draggingRef.current = true;
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', s.id);
                          setDragId(s.id);
                        }
                      : undefined
                  }
                  onDragEnter={s.pinned ? () => swapPinned(s.id) : undefined}
                  onDragEnd={s.pinned ? endDrag : undefined}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onRename={onRename}
                  onSetPinned={
                    s.status === 'draft'
                      ? undefined
                      : (pinned) => void setSessionPinned(s.id, pinned)
                  }
                />
              </Fragment>
            ))}
            {visible.length < ordered.length && <div ref={sentinelRef} aria-hidden className="h-1 shrink-0" />}
          </>
        )}
      </div>

      {/* 底部：设置入口（对齐 Cindy 用户胶囊位：icon 圆 + 文字的 pill 卡） */}
      <div className="px-3 pb-3">
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-full bg-card px-3 py-2 transition-colors hover:bg-hover select-none"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-board text-secondary">
            {profile.avatar ? (
              <img src={profile.avatar} alt="" className="h-6 w-6 object-cover" />
            ) : (
              <UserRound size={13} strokeWidth={1.8} />
            )}
          </span>
          <span className="min-w-0 truncate text-13 leading-tight font-medium text-primary">
            {profile.name || '设置'}
          </span>
        </Link>
      </div>
    </aside>
  );
}
