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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Bot, CirclePlus, MessageSquare, Pencil, Puzzle, Trash2, UserRound, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SessionListItem } from '../../../shared/fundet-api.js';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { getProfile, subscribeProfile } from '../lib/profile';
import { BrandMark } from './BrandMark';
import { SessionRenameInput } from './SessionRenameInput';
import { Tooltip } from './ui/Tooltip';
import { SidebarPanelDrawer, type SidebarPanelId } from './sidebar/SidebarPanelDrawer';

interface SidebarProps {
  sessions: SessionListItem[];
  activeId: string | null;
  /** 各会话是否有后台 turn 在跑（呼吸点提示） */
  runningIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** 空态常驻说明框：点「新对话」开启，开启后收起 */
  showNewHint?: boolean;
  width?: number;
  /** 拖拽条按下时回调（renderer 侧管理拖拽逻辑） */
  onResizeStart?: (e: React.PointerEvent) => void;
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
  'flex h-6 w-6 items-center justify-center rounded-full transition-opacity duration-120';

/** 超长会话列表的增量窗口（对齐 MessageStream 列表窗口化思路）：
 * 首窗渲染最近 60 条（侧栏一屏约 20 行），触底 sentinel 再扩 80 条。 */
const LIST_INITIAL = 60;
const LIST_EXTEND = 80;

/** 左上能力入口（独立抽屉面板，不再跳设置页） */
const PANEL_BUTTONS: Array<{ id: SidebarPanelId; label: string; Icon: typeof Bot }> = [
  { id: 'im', label: 'IM 机器人', Icon: Bot },
  { id: 'skills', label: '技能', Icon: Zap },
  { id: 'mcp', label: 'MCP 服务器', Icon: Puzzle },
  { id: 'knowledge', label: '知识库', Icon: BookOpen },
];

function SessionRow({
  session,
  isActive,
  isRunning,
  onSelect,
  onDelete,
  onRename,
}: {
  session: SessionListItem;
  isActive: boolean;
  isRunning: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const committed = useRef(false);
  const display = session.title || session.model || session.id.slice(0, 8);

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
      role="button"
      tabIndex={0}
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
      )}
    >
      <span className="flex w-[15px] shrink-0 items-center justify-center">
        {isRunning ? (
          <span className="h-2 w-2 animate-fundet-pulse rounded-full bg-warning" />
        ) : (
          <MessageSquare
            size={12}
            strokeWidth={1.8}
            className={isActive ? 'text-accent-fg' : 'text-muted'}
          />
        )}
      </span>

      {editing ? (
        <SessionRenameInput
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{display}</span>
      )}

      {!editing && (
        <div className="group/slot relative ml-auto flex h-6 min-w-12 shrink-0 items-center justify-end">
          <time
            className={cn(
              'text-12 font-medium tabular-nums transition-opacity duration-120',
              'group-hover:opacity-0 group-focus-within/slot:opacity-0',
              isActive ? 'text-accent-fg opacity-80' : 'text-muted',
            )}
          >
            {formatTime(session.updatedAt)}
          </time>
          <div
            className={cn(
              'absolute top-0 right-0 flex h-6 items-center',
              'transition-opacity duration-120',
              'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
              'group-focus-within/slot:pointer-events-auto group-focus-within/slot:opacity-100',
            )}
          >
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
}

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
}: SidebarProps): React.JSX.Element {
  const profile = useSyncExternalStore(subscribeProfile, getProfile, getProfile);

  // 左上能力入口的独立抽屉面板
  const [panel, setPanel] = useState<SidebarPanelId | null>(null);

  // 会话列表窗口化：limit 随滚动单调增长；activeId 落到窗口外时扩到覆盖
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [limit, setLimit] = useState(LIST_INITIAL);
  const activeIndex = activeId ? sessions.findIndex((s) => s.id === activeId) : -1;
  useEffect(() => {
    if (activeIndex >= limit) setLimit(activeIndex + 1);
  }, [activeIndex, limit]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((v) => (v < sessions.length ? v + LIST_EXTEND : v));
        }
      },
      { root: listRef.current, rootMargin: '200px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sessions.length]);
  const visible = sessions.slice(0, Math.min(limit, sessions.length));

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

      {/* 顶部常驻动作行：四个能力入口（独立抽屉面板，就地管理）+ 新对话 */}
      <div className="flex flex-col gap-0.5 px-3 pt-1 pb-2.5">
        {PANEL_BUTTONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel((p) => (p === id ? null : id))}
            aria-pressed={panel === id}
            className={cn(
              NAV_ROW_CLASS,
              panel === id ? 'bg-hover font-medium' : '',
            )}
          >
            <Icon size={15} strokeWidth={1.8} className={cn('shrink-0', panel === id ? 'text-primary' : 'text-muted')} />
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

      {/* 会话区标签（对齐 Cindy 的「Chat」段标） */}
      <div className="px-6 pt-1 pb-1 text-13 text-muted select-none">会话</div>

      {/* 会话列表 */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
        {sessions.length === 0 && (
          <div className="px-3 pt-1 text-13 text-muted select-none">还没有会话</div>
        )}
        {visible.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            isActive={s.id === activeId}
            isRunning={runningIds.has(s.id)}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
        {visible.length < sessions.length && <div ref={sentinelRef} aria-hidden className="h-1 shrink-0" />}
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

      {/* 左上能力入口的独立抽屉面板（portal） */}
      {panel && <SidebarPanelDrawer panel={panel} onClose={() => setPanel(null)} />}
    </aside>
  );
}
