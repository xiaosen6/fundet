/**
 * MessageStream — 消息滚动容器。
 *
 * 自动贴底（对齐 Cindy autoFollowIntent + RO auto-follow）：用户向上滚的任何
 * 输入意图（wheel/触摸/PageUp，哪怕 1px）立即解除跟随，程序化 scrollTop 不触发
 * 这些事件、天然不误判；恢复需「向下滚 + 贴死底部 ≤8px」双信号。内容高度任何
 * 来源增长（token/图片加载/卡片展开）由 ResizeObserver 捕获，贴底态就跟随。
 * 渲染 slice.items + 未封口的流式文本。
 *
 * 视觉复刻 Cindy 消息流：
 * - 用户气泡：右对齐、max-w-[488px]、Card 底 + 1px Board + 12px 圆角、px-4 py-3、
 *   text-15 leading-[1.6]。
 * - 助手正文：无气泡，通栏 text-15 leading-[1.6]（.md 样式在 globals.css）。
 * - thinking / 工具卡片：见各自组件（无卡片边框的 rail 风格 / 12px 卡片）。
 * - 错误卡：error token 三件套；系统通知：居中灰字。
 * - 条目间距 gap-3.5（14px，对齐 Cindy msg-stream-items）。
 * - 每轮完成后的助手消息挂 MessageActionBar（复制 / 分享 / 分叉 / 更多），
 *   不含「复制当前消息链接」。
 */
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { AlertCircle, ArrowDown, Info } from 'lucide-react';
import type { DisplayItem, SessionSlice } from '../stores/sessionStore';
import { AssistantMessage } from './AssistantMessage';
import { MessageActionBar } from './MessageActionBar';
import { ShareTurnModal, type ShareTurnPayload } from './ShareTurnModal';
import { groupWorkItems, WorkGroupBlock } from './WorkGroupBlock';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { mayExceedVisualLineThreshold, useUserMessageAutoCollapse } from './chat/userMessageCollapse';
import { parseKnowledgeSources, type KnowledgeSource } from '../lib/knowledgeCite';

/** 用户消息气泡：长文本自动收起（抄 Cindy userMessageCollapse：镜像节点实测行数
 * + ResizeObserver 跟宽重算），折叠态 line-clamp-10 + 「展开全文 / 收起」。 */
function UserBubble({
  text,
  attachments,
  onOpenFile,
}: {
  text: string;
  attachments?: Array<{ path: string; name: string }>;
  onOpenFile?: (path: string) => void;
}) {
  const mayExceed = mayExceedVisualLineThreshold(text);
  const { mirrorRef, shouldCollapse } = useUserMessageAutoCollapse(text, mayExceed);
  const [expanded, setExpanded] = useState(false);
  const collapsed = shouldCollapse && !expanded;
  return (
    <div className="flex justify-end">
      <div className="max-w-[488px] rounded-container border border-board bg-card px-4 py-3 text-15 leading-[1.6] text-primary select-text">
        {attachments && attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <button
                key={a.path}
                type="button"
                title={a.path}
                className="max-w-full truncate rounded-full border border-board bg-chip px-2 py-0.5 text-11 text-secondary hover:text-primary"
                onClick={() => onOpenFile?.(a.path)}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
        {mayExceed ? (
          <div
            ref={mirrorRef}
            aria-hidden
            className="max-h-0 overflow-hidden whitespace-pre-wrap break-words text-15 leading-[1.6] [overflow-wrap:anywhere]"
          >
            {text}
          </div>
        ) : null}
        <div
          className={cn(
            'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
            collapsed && 'line-clamp-10',
          )}
        >
          {text}
        </div>
        {shouldCollapse ? (
          <button
            type="button"
            className="mt-1.5 flex items-center gap-1 text-13 text-secondary hover:text-primary"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '展开全文'}
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type AssistantItem = Extract<DisplayItem, { kind: 'assistant' }>;
type GroupedRow = ReturnType<typeof groupWorkItems>[number];

interface MessageStreamProps {
  slice: SessionSlice;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  canFork?: boolean;
  onFork?: (createdAt: number) => Promise<void>;
  onAddToChat?: (text: string) => void;
  onDelete?: (assistantId: string) => Promise<void>;
  /** 终态错误卡的「重新发送」：重发本轮最后一条用户消息 */
  onRetryError?: () => void;
}

function isTurnTailAssistant(
  grouped: GroupedRow[],
  index: number,
  isRunning: boolean,
  hasStreaming: boolean,
): boolean {
  const item = grouped[index];
  if (!item || item.kind !== 'assistant') return false;
  for (let j = index + 1; j < grouped.length; j++) {
    const next = grouped[j];
    if (next.kind === 'assistant' || next.kind === 'work_group') return false;
    if (next.kind === 'user') return true;
  }
  return !isRunning && !hasStreaming;
}

const KNOWLEDGE_TOOL_NAME = 'mcp__knowledge__knowledge_search';

/** 本轮 knowledge_search 的来源清单（回复中的【n】角标可点开溯源） */
function knowledgeSourcesFor(items: DisplayItem[], assistantId: string): KnowledgeSource[] {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === assistantId);
  if (idx < 0) return [];
  const sources: KnowledgeSource[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'tool' && it.toolName === KNOWLEDGE_TOOL_NAME && it.resultText) {
      for (const src of parseKnowledgeSources(it.resultText)) {
        if (!sources.some((s) => s.n === src.n)) sources.push(src);
      }
    }
  }
  return sources;
}

function lastUserTextBefore(items: DisplayItem[], assistantId: string): string {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === assistantId);
  if (idx < 0) return '';
  for (let i = idx - 1; i >= 0; i--) {
    const prev = items[i];
    if (prev.kind === 'user') return prev.text;
  }
  return '';
}

function AssistantTurn({
  item,
  pinned,
  workDir,
  onOpenFile,
  onShare,
  onFork,
  onAddToChat,
  onDelete,
  knowledgeSources,
}: {
  item: AssistantItem;
  pinned: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  onShare?: () => void;
  onFork?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
  knowledgeSources?: KnowledgeSource[];
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex justify-start"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-full max-w-full min-w-0">
        <AssistantMessage
          text={item.text}
          workDir={workDir}
          onOpenFile={onOpenFile}
          knowledgeSources={knowledgeSources}
        />
        <MessageActionBar
          createdAt={item.createdAt}
          copyText={item.text}
          usage={item.usage}
          hovered={hovered}
          pinned={pinned}
          onShare={onShare}
          onFork={onFork}
          onAddToChat={onAddToChat}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/** 窗口化（对齐 Cindy render-window）：首帧只挂末尾 N 条，滚到顶逐步扩窗；
 * 窗口外不进 DOM，叠加 content-visibility 把长会话首帧成本压到一屏。 */
const FIRST_PAINT_ITEMS = 15;
const EXPAND_STEP = 80;
/** 空闲期自动扩到的窗口上限（对齐 Cindy INITIAL_ITEMS） */
const INITIAL_ITEMS = 80;
/** 距顶多少 px 内触发扩窗 */
const EXPAND_AT_TOP_PX = 120;

/** 底部居中悬浮 pill（对齐 Cindy JumpToBottomChip / NewMessageIndicator 同款规格，
 * 两者互斥共存：有未读时显示计数，否则显示跳底快捷钮） */
function StreamBottomChip({
  visible,
  label,
  onClick,
}: {
  visible: boolean;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'absolute bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-150 ease-out',
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-8 items-center gap-1.5 rounded-full border border-board bg-card px-3 py-1.5 text-12 font-medium leading-none text-secondary shadow-[var(--shadow-menu)] transition-colors duration-150 hover:bg-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <ArrowDown size={14} className="shrink-0" />
        <span className="translate-y-[0.5px]">{label}</span>
      </button>
    </div>
  );
}

export function MessageStream({
  slice,
  workDir,
  onOpenFile,
  canFork,
  onFork,
  onAddToChat,
  onDelete,
  onRetryError,
}: MessageStreamProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const [windowSize, setWindowSize] = useState(FIRST_PAINT_ITEMS);
  const pendingAnchorRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const [sharePayload, setSharePayload] = useState<ShareTurnPayload | null>(null);
  const grouped = useMemo(
    () => groupWorkItems(slice.items, slice.isRunning),
    [slice.items, slice.isRunning],
  );
  const hasStreaming = Boolean(slice.streamingText);
  const windowStart = Math.max(0, grouped.length - windowSize);
  const visibleGrouped = windowStart > 0 ? grouped.slice(windowStart) : grouped;
  const hiddenCount = windowStart;
  const pinnedId = useMemo(() => {
    if (slice.isRunning || hasStreaming) return null;
    for (let i = grouped.length - 1; i >= 0; i--) {
      const it = grouped[i];
      if (it.kind === 'assistant') return it.id;
    }
    return null;
  }, [grouped, slice.isRunning, hasStreaming]);

  // 贴底态镜像到 state（chip 渲染用）+ 未读计数（脱离底部后新增的条目数）
  const reducedMotion = useReducedMotion();
  const [stuck, setStuckState] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const lastSeenLenRef = useRef(0);
  const setStuck = (v: boolean): void => {
    stickRef.current = v;
    setStuckState(v);
    if (v) {
      lastSeenLenRef.current = grouped.length;
      setUnseen(0);
    }
  };

  useEffect(() => {
    if (stuck) {
      lastSeenLenRef.current = grouped.length;
      setUnseen(0);
    } else {
      setUnseen(Math.max(0, grouped.length - lastSeenLenRef.current));
    }
  }, [grouped.length, stuck]);

  const unpin = (): void => {
    setStuck(false);
  };

  const scrollToBottom = (): void => {
    const el = containerRef.current;
    if (!el) return;
    setStuck(true);
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const handleScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const goingDown = el.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    // 恢复贴底：向下滚 + 贴死底部双信号（≤8px，Cindy REPIN_AT_BOTTOM_PX 口径）
    if (!stickRef.current && goingDown && distance <= 8) setStuck(true);
    // 悬浮跳底钮显隐：脱离贴底且离底足够远（近距不闪）
    setShowJump(distance > 150 && !stickRef.current);
    // 触顶扩窗：上方还有窗口外条目时向上读历史逐段挂载。
    // 记录当前窗口首元素的视口位置，扩窗提交后按漂移补偿（不猜浏览器
    // anchoring 是否生效，直接量同节点位移，天然无双补偿）。
    if (el.scrollTop < EXPAND_AT_TOP_PX && windowStart > 0) {
      const anchorEl = (contentRef.current?.children[windowStart] ?? null) as HTMLElement | null;
      pendingAnchorRef.current = anchorEl ? { el: anchorEl, top: anchorEl.getBoundingClientRect().top } : null;
      setWindowSize((w) => Math.min(w + EXPAND_STEP, grouped.length));
    }
  };

  // 扩窗提交后：按锚点元素的实际位移补偿 scrollTop，视口纹丝不动
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    pendingAnchorRef.current = null;
    const drift = pending.el.getBoundingClientRect().top - pending.top;
    if (Math.abs(drift) > 1) {
      const el = containerRef.current;
      if (el) el.scrollTop += drift;
    }
  }, [windowStart]);

  // 内容高度任何来源增长（token 追加/图片加载/卡片展开/CV 纠偏）且贴底态 → 跟底
  useEffect(() => {
    const content = contentRef.current;
    const el = containerRef.current;
    if (!content || !el) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // 空闲期自动扩窗到 80：正常体量的会话很快全量可见，只有真长会话才保留窗口
  useEffect(() => {
    if (windowSize >= INITIAL_ITEMS) return undefined;
    const id = setTimeout(() => setWindowSize((w) => Math.max(w, INITIAL_ITEMS)), 600);
    return () => clearTimeout(id);
  }, [windowSize]);

  // 切换会话（items 引用整体替换）时重置贴底与窗口
  const historyLoadMark = useMemo(() => ({ at: performance.now() }), [slice.historyLoaded]);
  useEffect(() => {
    setStuck(true);
    lastScrollTopRef.current = 0;
    setShowJump(false);
    setWindowSize(FIRST_PAINT_ITEMS);
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // ⑧ 渲染基线：historyLoaded 变化（render 起点挂 mark）→ 本 effect（commit 后）
    console.debug('[perf] stream first-paint', Math.round(performance.now() - historyLoadMark.at), 'ms');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.historyLoaded]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={(e) => {
          if (e.deltaY < 0) unpin();
        }}
        onTouchStart={(e) => {
          touchStartYRef.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(e) => {
          const startY = touchStartYRef.current;
          const y = e.touches[0]?.clientY;
          if (startY !== null && y !== undefined && startY - y > 1) unpin();
        }}
        onKeyDown={(e) => {
          if (e.key === 'PageUp' || e.key === 'ArrowUp') unpin();
        }}
        className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-4"
      >
      <div ref={contentRef} className="msg-stream-items mx-auto flex max-w-[820px] flex-col gap-3.5">
        {slice.items.length === 0 && !slice.streamingText && (
          <div className="pt-24 text-center text-13 text-muted select-none">
            输入消息或拖入文件开始对话
          </div>
        )}

        {hiddenCount > 0 && (
          <div className="pt-1 text-center text-12 text-muted select-none">
            已省略上方 {hiddenCount} 条 · 向上滚动加载
          </div>
        )}

        {visibleGrouped.map((item, relIndex) => {
          const index = windowStart + relIndex;
          if (item.kind === 'work_group') {
            return (
              <WorkGroupBlock
                key={item.id}
                childrenItems={item.children}
                streaming={item.streaming}
                workDir={workDir}
                onOpenFile={onOpenFile}
              />
            );
          }
          switch (item.kind) {
            case 'user':
              return <UserBubble key={item.id} text={item.text} attachments={item.attachments} onOpenFile={onOpenFile} />
            case 'assistant': {
              const showBar = isTurnTailAssistant(grouped, index, slice.isRunning, hasStreaming);
              const kbSources = knowledgeSourcesFor(slice.items, item.id);
              if (!showBar) {
                return (
                  <div key={item.id} className="flex justify-start">
                    <div className="w-full max-w-full min-w-0">
                      <AssistantMessage
                        text={item.text}
                        workDir={workDir}
                        onOpenFile={onOpenFile}
                        knowledgeSources={kbSources}
                      />
                    </div>
                  </div>
                );
              }
              const userText = lastUserTextBefore(slice.items, item.id);
              const createdAt = item.createdAt;
              return (
                <AssistantTurn
                  key={item.id}
                  item={item}
                  pinned={item.id === pinnedId}
                  workDir={workDir}
                  onOpenFile={onOpenFile}
                  knowledgeSources={kbSources}
                  onShare={() =>
                    setSharePayload({
                      userText,
                      assistantText: item.text,
                      createdAt: item.createdAt,
                    })
                  }
                  onFork={
                    canFork && createdAt && onFork ? () => onFork(createdAt) : undefined
                  }
                  onAddToChat={onAddToChat ? () => onAddToChat(item.text) : undefined}
                  onDelete={onDelete ? () => onDelete(item.id) : undefined}
                />
              );
            }
            case 'error':
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2 rounded-inner border border-error-border bg-error-bg px-3 py-2"
                >
                  <AlertCircle size={14} className="mt-[2px] shrink-0 text-error" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-13 break-all whitespace-pre-wrap text-error select-text">
                      {item.message}
                    </span>
                    {onRetryError && (
                      <button
                        type="button"
                        onClick={onRetryError}
                        className="mt-1.5 rounded-full border border-error-border px-2.5 py-0.5 text-12 text-error transition-colors hover:bg-error-bg/60"
                      >
                        重新发送
                      </button>
                    )}
                  </div>
                </div>
              );
            case 'notice':
              return (
                <div key={item.id} className="flex items-center justify-center gap-1.5 select-none">
                  <Info size={12} className="text-muted" />
                  <span className="text-12 text-muted">{item.text}</span>
                </div>
              );
            default:
              return null;
          }
        })}

        {/* 未封口的流式文本（逐词淡入由 AssistantMessage streaming 分支处理） */}
        {slice.streamingText && (
          <div className="flex justify-start">
            <div className="w-full max-w-full min-w-0">
              <AssistantMessage
                text={slice.streamingText}
                streaming
                workDir={workDir}
                onOpenFile={onOpenFile}
              />
            </div>
          </div>
        )}
      </div>
      {sharePayload ? (
        <ShareTurnModal payload={sharePayload} onClose={() => setSharePayload(null)} />
      ) : null}
      </div>
      {/* 有未读时计数优先，无未读时显示跳底快捷钮（互斥，Cindy 同款） */}
      <StreamBottomChip
        visible={!stuck && unseen > 0}
        label={`${unseen} 条新消息`}
        onClick={scrollToBottom}
      />
      <StreamBottomChip
        visible={!stuck && unseen === 0 && showJump}
        label="跳到底部"
        onClick={scrollToBottom}
      />
    </div>
  );
}
