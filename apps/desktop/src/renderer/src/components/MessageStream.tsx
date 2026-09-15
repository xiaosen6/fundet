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
import { useEffect, useMemo, useState, useRef } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, Copy, Info, Pen, Quote } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DisplayItem, SessionSlice } from '../stores/sessionStore';
import { AssistantMessage } from './AssistantMessage';
import { MessageActionBar } from './MessageActionBar';
import { ShareTurnModal, type ShareTurnPayload } from './ShareTurnModal';
import { groupWorkItems, WorkGroupBlock } from './WorkGroupBlock';
import { AgentTaskCard } from './AgentTaskCard';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Tooltip } from './ui/Tooltip';
import { mayExceedVisualLineThreshold, useUserMessageAutoCollapse } from './chat/userMessageCollapse';
import { parseKnowledgeSources, type KnowledgeSource } from '../lib/knowledgeCite';

/** 用户消息气泡：长文本自动收起（抄 Cindy userMessageCollapse：镜像节点实测行数
 * + ResizeObserver 跟宽重算），折叠态 line-clamp-10 + 「展开全文 / 收起」。
 * hover 浮出操作栏（Cindy 同款：复制 + 编辑，编辑走 composer 截断重发）。 */
function UserBubble({
  text,
  attachments,
  onOpenFile,
  onEdit,
}: {
  text: string;
  attachments?: Array<{ path: string; name: string }>;
  onOpenFile?: (path: string) => void;
  onEdit?: (text: string) => void;
}): React.JSX.Element {
  const mayExceed = mayExceedVisualLineThreshold(text);
  const { mirrorRef, shouldCollapse } = useUserMessageAutoCollapse(text, mayExceed);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const collapsed = shouldCollapse && !expanded;

  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <div
      className="flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
      {/* hover 操作栏：复制 / 编辑（与 assistant 的 MessageActionBar 同款节奏） */}
      <div
        className={cn(
          'mt-1 flex h-6 items-center justify-end gap-0.5 transition-opacity duration-150',
          hovered ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Tooltip label={copied ? '已复制' : '复制'} side="top">
          <button
            type="button"
            aria-label="复制"
            className="group flex h-6 w-6 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-hover hover:text-primary"
            onClick={() => {
              void window.fundet.copyText(text).then(() => setCopied(true));
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </Tooltip>
        {onEdit ? (
          <Tooltip label="编辑" side="top">
            <button
              type="button"
              aria-label="编辑"
              className="group flex h-6 w-6 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-hover hover:text-primary"
              onClick={() => onEdit(text)}
            >
              <Pen size={14} />
            </button>
          </Tooltip>
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
  /** 编辑某条用户消息（消息操作栏 Pen）：文本进 composer + 截断重发流 */
  onEditUserMessage?: (text: string, createdAt: number) => void;
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

/** 虚拟行初估高度（动态测量迅速校正；粗估只影响首帧滚动条长度） */
const ESTIMATE_ROW_PX = 140;
/** 视口外上下各多渲染的行数 */
const OVERSCAN_ROWS = 8;

/** assistant 行渲染（虚拟化后从行 switch 抽出；含 turn 尾判定与操作栏挂载） */
function AssistantRow({
  item,
  index,
  grouped,
  slice,
  hasStreaming,
  pinnedId,
  workDir,
  onOpenFile,
  canFork,
  onFork,
  onAddToChat,
  onDelete,
  setSharePayload,
}: {
  item: AssistantItem;
  index: number;
  grouped: GroupedRow[];
  slice: SessionSlice;
  hasStreaming: boolean;
  pinnedId: string | null;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  canFork?: boolean;
  onFork?: (createdAt: number) => Promise<void>;
  onAddToChat?: (text: string) => void;
  onDelete?: (id: string) => Promise<void>;
  setSharePayload: React.Dispatch<React.SetStateAction<ShareTurnPayload | null>>;
}): React.JSX.Element {
  const showBar = isTurnTailAssistant(grouped, index, slice.isRunning, hasStreaming);
  const kbSources = knowledgeSourcesFor(slice.items, item.id);
  if (!showBar) {
    return (
      <div className="flex justify-start">
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
      onFork={canFork && createdAt && onFork ? () => onFork(createdAt) : undefined}
      onAddToChat={onAddToChat ? () => onAddToChat(item.text) : undefined}
      onDelete={onDelete ? () => onDelete(item.id) : undefined}
    />
  );
}

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
  onEditUserMessage,
}: MessageStreamProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const [sharePayload, setSharePayload] = useState<ShareTurnPayload | null>(null);
  const grouped = useMemo(
    () => groupWorkItems(slice.items, slice.isRunning),
    [slice.items, slice.isRunning],
  );
  const hasStreaming = Boolean(slice.streamingText);
  // 虚拟化行 = 分组行 + 流式未封口伪行（永远最后一行）
  const rows = useMemo<Array<GroupedRow | { kind: 'streaming'; id: string }>>(
    () => (slice.streamingText ? [...grouped, { kind: 'streaming', id: '__streaming__' }] : grouped),
    [grouped, slice.streamingText],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATE_ROW_PX,
    overscan: OVERSCAN_ROWS,
    getItemKey: (i) => rows[i]!.id,
  });
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
    setStuck(true);
    if (rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, {
        align: 'end',
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  };

  // 跳到上一条提问（对齐 Cindy PrevMessageJumpChip：icon-only 圆钮落右上角）。
  // rAF 节流地找「视口首个可见条目」之前最近的一条 user 消息。
  const [prevQuestion, setPrevQuestion] = useState<{ index: number; preview: string } | null>(null);
  const userIndexes = useMemo(() => {
    const idx: number[] = [];
    grouped.forEach((g, i) => {
      if (g.kind === 'user') idx.push(i);
    });
    return idx;
  }, [grouped]);
  const rafPendingRef = useRef(false);
  const updatePrevQuestion = (): void => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const el = containerRef.current;
      if (!el || rows.length === 0) {
        setPrevQuestion(null);
        return;
      }
      // 首个与视口顶相交的虚拟行（items 有序，含 overscan）
      const offset = el.scrollTop;
      let firstVisible = -1;
      for (const it of virtualizer.getVirtualItems()) {
        if (it.end >= offset + 4) {
          firstVisible = it.index;
          break;
        }
      }
      if (firstVisible <= 0) {
        setPrevQuestion(null);
        return;
      }
      let prev = -1;
      for (const ui of userIndexes) {
        if (ui < firstVisible) prev = ui;
        else break;
      }
      const item = prev >= 0 ? grouped[prev] : undefined;
      if (prev < 0 || !item || item.kind !== 'user') {
        setPrevQuestion(null);
        return;
      }
      const preview = (item.text.split('\n').find((l) => l.trim().length > 0) ?? '')
        .trim()
        .slice(0, 60);
      setPrevQuestion({ index: prev, preview });
    });
  };

  const jumpToPrevQuestion = (): void => {
    if (!prevQuestion) return;
    unpin();
    virtualizer.scrollToIndex(prevQuestion.index, {
      align: 'start',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  // 划选引用：消息文本被划选后浮出「引用」钮（点击走 onAddToChat，> 前缀引用）
  const [quoteSel, setQuoteSel] = useState<{ x: number; y: number; text: string } | null>(null);
  const handleMouseUp = (): void => {
    const el = containerRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed || !onAddToChat) {
      setQuoteSel(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length > 500) {
      setQuoteSel(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const anchor = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    if (!anchor || !el.contains(anchor)) {
      setQuoteSel(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrapRect = el.getBoundingClientRect();
    setQuoteSel({
      x: rect.left - wrapRect.left + Math.min(rect.width / 2, 200),
      y: Math.max(4, rect.top - wrapRect.top - 34),
      text,
    });
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
    // 滚动时收起划选引用钮（选区与按钮错位没有意义）
    setQuoteSel(null);
    // 右上角「上一条提问」跳钮探测（rAF 节流）
    updatePrevQuestion();
  };

  // 切会话后重估「上一条提问」跳钮（视口内容变了）
  useEffect(() => {
    updatePrevQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.historyLoaded]);

  // 内容高度任何来源增长（token 追加/图片加载/卡片展开/测量校正）且贴底态 → 跟底。
  // 虚拟化后内容高度 = virtualizer 总尺寸，观察挂载容器即可。
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current && rows.length > 0) {
        virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // 切换会话（items 引用整体替换）时重置贴底；rAF 后行测量就位再定位底
  const historyLoadMark = useMemo(() => ({ at: performance.now() }), [slice.historyLoaded]);
  useEffect(() => {
    setStuck(true);
    lastScrollTopRef.current = 0;
    setShowJump(false);
    requestAnimationFrame(() => {
      if (rows.length > 0) {
        virtualizer.scrollToIndex(rows.length - 1, { align: 'end', behavior: 'auto' });
      }
    });
    // ⑧ 渲染基线：historyLoaded 变化（render 起点挂 mark）→ 本 effect（commit 后）
    console.debug('[perf] stream first-paint', Math.round(performance.now() - historyLoadMark.at), 'ms');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.historyLoaded]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
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
          if (e.key === 'Escape') setQuoteSel(null);
        }}
        /* 浏览器滚动锚定会与虚拟化的位移补偿互相打架，显式关掉 */
        style={{ overflowAnchor: 'none' }}
        className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-4"
      >
      <div
        ref={contentRef}
        className="msg-stream-items relative mx-auto w-full max-w-[820px]"
        style={rows.length > 0 ? { height: virtualizer.getTotalSize() } : undefined}
      >
        {rows.length === 0 && (
          <div className="pt-24 text-center text-13 text-muted select-none">
            输入消息或拖入文件开始对话
          </div>
        )}

        {virtualizer.getVirtualItems().map((vr) => {
          const item = rows[vr.index]!;
          return (
            <div
              key={vr.key}
              data-index={vr.index}
              data-virtual
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${vr.start}px)` }}
            >
              {/* 行间距内化为行内 padding（绝对定位下容器 gap 失效） */}
              <div className="pb-3.5">
                {item.kind === 'work_group' ? (
                  <WorkGroupBlock
                    childrenItems={item.children}
                    streaming={item.streaming}
                    workDir={workDir}
                    onOpenFile={onOpenFile}
                  />
                ) : item.kind === 'streaming' ? (
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
                ) : item.kind === 'user' ? (
                  <UserBubble
                    text={item.text}
                    attachments={item.attachments}
                    onOpenFile={onOpenFile}
                    onEdit={
                      onEditUserMessage && item.createdAt
                        ? (t) => onEditUserMessage(t, item.createdAt!)
                        : undefined
                    }
                  />
                ) : item.kind === 'assistant' ? (
                  <AssistantRow
                    item={item}
                    index={vr.index}
                    grouped={grouped}
                    slice={slice}
                    hasStreaming={hasStreaming}
                    pinnedId={pinnedId}
                    workDir={workDir}
                    onOpenFile={onOpenFile}
                    canFork={canFork}
                    onFork={onFork}
                    onAddToChat={onAddToChat}
                    onDelete={onDelete}
                    setSharePayload={setSharePayload}
                  />
                ) : item.kind === 'error' ? (
                  <div className="flex items-start gap-2 rounded-inner border border-error-border bg-error-bg px-3 py-2">
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
                ) : item.kind === 'notice' ? (
                  <div className="flex items-center justify-center gap-1.5 select-none">
                    <Info size={12} className="text-muted" />
                    <span className="text-12 text-muted">{item.text}</span>
                  </div>
                ) : item.kind === 'task' ? (
                  <AgentTaskCard item={item} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {sharePayload ? (
        <ShareTurnModal payload={sharePayload} onClose={() => setSharePayload(null)} />
      ) : null}
      </div>
      {/* 右上角「跳到上一条提问」（icon-only 圆钮，对齐 Cindy；hover 预览问题原文） */}
      {prevQuestion && (
        <div className="absolute top-4 right-4 z-40">
          <Tooltip label={prevQuestion.preview || '上一条提问'}>
            <button
              type="button"
              aria-label="跳到上一条提问"
              onClick={jumpToPrevQuestion}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-board bg-card text-secondary shadow-[var(--shadow-menu)] transition-colors hover:bg-hover hover:text-primary active:scale-[0.98]"
            >
              <ArrowUp size={14} />
            </button>
          </Tooltip>
        </div>
      )}
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
      {/* 划选引用浮钮（选区上方居中） */}
      {quoteSel && (
        <div className="absolute z-50 -translate-x-1/2" style={{ left: quoteSel.x, top: quoteSel.y }}>
          <button
            type="button"
            // preventDefault 保住选区，click 才读得到原文
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAddToChat?.(quoteSel.text);
              window.getSelection()?.removeAllRanges();
              setQuoteSel(null);
            }}
            className="flex h-7 items-center gap-1.5 rounded-full border border-board bg-card px-2.5 text-12 text-secondary shadow-[var(--shadow-menu)] hover:bg-hover active:scale-[0.98]"
          >
            <Quote size={12} />
            引用
          </button>
        </div>
      )}
    </div>
  );
}
