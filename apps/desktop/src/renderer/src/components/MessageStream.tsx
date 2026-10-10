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
 * - 消息导航条（Cindy MessageNavRail 整套移植）：左缘刻度列（每条用户提问一根
 *   刻度，当前阅读轮加深，hover 预览「提问 + 回答摘要」，点击跳回那一轮）；
 *   ≥4 轮且左留白足够才出场；完整覆盖导航时抑制右上角「跳到上一条提问」chip。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, Copy, FilePlus2, Info, Loader2, Pen, Quote } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getFocusedSessionId, type DisplayItem, type SessionSlice } from '../stores/sessionStore';
import type { SessionAttachment } from '../../../shared/fundet-api.js';
import { AssistantMessage } from './AssistantMessage';
import { AttachmentThumb } from './AttachmentThumb';
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
import { MessageNavRail } from './chat/MessageNavRail';
import {
  NAV_RAIL_JUMP_TOP_OFFSET_PX,
  deriveNavRailEntries,
  promptPreviewLine,
} from './chat/messageNavRailModel';

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
}): React.JSX.Element {
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
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-board bg-chip py-0.5 pl-1 pr-2 text-11 text-secondary hover:text-primary"
                onClick={() => onOpenFile?.(a.path)}
              >
                <AttachmentThumb path={a.path} />
                <span className="min-w-0 truncate">{a.name}</span>
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

/** 用户消息整轮（气泡 + MessageActionBar：时间/复制/分享/分叉/编辑/删除，与 assistant 同栏同款）。
 * 操作栏右对齐到气泡下方（Cindy 同款）。 */
function UserTurn({
  item,
  canFork,
  onFork,
  onShare,
  onDeleteUserMessage,
  workDir,
  onOpenFile,
  onRewind,
  canEdit,
  onEditStart,
  onEditSubmit,
}: {
  item: Extract<DisplayItem, { kind: 'user' }>;
  canFork?: boolean;
  onFork?: (createdAt: number) => Promise<void>;
  onShare?: () => void;
  onDeleteUserMessage?: () => void;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  onRewind?: () => void;
  /** 仅最后一条 user 消息可编辑（Cindy edit-last-message） */
  canEdit?: boolean;
  /** 点编辑瞬间（外部据此中断运行中的 turn，Cindy：点编辑=停下要改） */
  onEditStart?: () => void;
  /** 提交编辑：截断该消息及之后全部内容并按新文本重发 */
  onEditSubmit?: (text: string, createdAt: number | undefined, attachments: SessionAttachment[] | undefined) => Promise<void>;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  // ── inline 编辑态（Cindy UserMessageEditBox 同款交互）：气泡原位替换成
  // textarea 预填原文；运行中点编辑由外部立即中断；提交才截断重发，取消零副作用。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [submitting, setSubmitting] = useState(false);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(item.text);
    const id = requestAnimationFrame(() => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    });
    return () => cancelAnimationFrame(id);
  }, [editing, item.text]);

  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(item.text);
  };

  const submitEdit = (): void => {
    if (submitting || !onEditSubmit) return;
    const text = draft.trim() ? draft : item.text;
    setSubmitting(true);
    void onEditSubmit(text, item.createdAt, item.attachments)
      .then(() => setEditing(false))
      .finally(() => setSubmitting(false));
  };

  return (
    <div
      className="flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <div className="flex justify-end">
          <div className="flex max-w-[488px] flex-col rounded-container border border-[var(--focus-ring)] bg-composer-pill px-3.5 py-3">
            {item.attachments && item.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {item.attachments.map((a) => (
                  <span
                    key={a.path}
                    title={a.path}
                    className="max-w-full truncate rounded-full border border-board bg-card px-2 py-0.5 text-11 text-muted"
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitEdit();
                }
              }}
              rows={1}
              className="w-full resize-none bg-transparent text-15 leading-[1.6] text-primary outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-7 rounded-full border border-board px-3 text-12 text-secondary hover:bg-hover"
                onClick={cancelEdit}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                className="flex h-7 items-center gap-1.5 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-50"
                onClick={submitEdit}
                disabled={submitting}
              >
                {submitting && <Loader2 size={12} className="animate-fundet-spin" aria-hidden />}
                {submitting ? '等待中断…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <UserBubble text={item.text} attachments={item.attachments} onOpenFile={onOpenFile} />
      )}
      <div className="flex justify-end">
        <MessageActionBar
          createdAt={item.createdAt}
          copyText={item.text}
          hovered={hovered}
          onShare={onShare}
          onFork={
            canFork && item.createdAt && onFork
              ? () => {
                  const ts = item.createdAt;
                  if (ts !== undefined) return onFork(ts);
                  return Promise.resolve();
                }
              : undefined
          }
          onEdit={
            canEdit && onEditSubmit
              ? () => {
                  onEditStart?.();
                  setEditing(true);
                }
              : undefined
          }
          onRewind={onRewind}
          align="right"
          onDelete={onDeleteUserMessage ? async () => onDeleteUserMessage() : undefined}
        />
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
  onRewind?: () => void;
  /** 终态错误卡的「重新发送」：重发本轮最后一条用户消息 */
  onRetryError?: () => void;
  /** 编辑入口（仅最后一条 user 消息显示）：点击瞬间回调（外部据此中断运行中 turn） */
  onEditStart?: () => void;
  /** 提交编辑：截断该消息及之后全部内容并按新文本重发 */
  onEditSubmit?: (
    text: string,
    createdAt: number | undefined,
    attachments: SessionAttachment[] | undefined,
  ) => Promise<void>;
  /** 删除某条用户消息及其后全部内容（confirm 在调用方） */
  onDeleteUserMessage?: (createdAt: number) => void;
  /** Canvas 产物全集：助手正文里命中 basename/路径形状的片段升级为路径 chip */
  artifactPaths?: string[];
  /** 轮末改动卡 slot：渲染在消息流末尾（最后一轮回复下方，跟内容滚动不浮动） */
  turnChangesSlot?: React.ReactNode;
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

/** pi 结构化写工具（产出文件卡的判定集；bash 写入路径不可知，不纳入） */
const WRITE_TOOLS = new Set(['write', 'edit']);

/** 本轮产出文件：assistant 消息回溯到上一条 user 消息之间的 write/edit 目标路径 */
function generatedFilesFor(items: DisplayItem[], assistantId: string): string[] {
  const idx = items.findIndex((it) => it.id === assistantId);
  if (idx < 0) return [];
  const files: string[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'tool' && WRITE_TOOLS.has(it.toolName)) {
      const p = typeof it.input?.['path'] === 'string' ? (it.input['path'] as string) : '';
      if (p && !files.includes(p)) files.unshift(p);
    }
  }
  return files.slice(0, 8);
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
  turnFiles,
  artifactPaths,
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
  /** 本轮 write/edit 产出的文件（Cindy GeneratedFilesCard 简化版） */
  turnFiles?: string[];
  /** Canvas 产物全集：正文路径 chip 用 */
  artifactPaths?: string[];
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
          artifactPaths={artifactPaths}
        />
        {turnFiles && turnFiles.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="flex shrink-0 items-center gap-1 text-11 text-muted select-none">
              <FilePlus2 size={12} aria-hidden />
              产出
            </span>
            {turnFiles.map((p) => (
              <button
                key={p}
                type="button"
                title={p}
                className="max-w-[220px] truncate rounded-full border border-board bg-chip px-2 py-0.5 text-11 text-secondary transition-colors hover:text-primary"
                onClick={() => onOpenFile?.(p)}
              >
                {p.replace(/\\/g, '/').split('/').pop()}
              </button>
            ))}
          </div>
        )}
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
          align="left"
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
  artifactPaths,
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
  artifactPaths?: string[];
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
            artifactPaths={artifactPaths}
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
      turnFiles={generatedFilesFor(slice.items, item.id)}
      artifactPaths={artifactPaths}
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
        'absolute bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]',
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-8 items-center gap-1.5 rounded-full border border-board bg-card px-3 py-1.5 text-12 font-medium leading-none text-secondary shadow-[var(--shadow-menu)] transition-colors duration-[var(--motion-fast)] hover:bg-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <ArrowDown size={14} className="shrink-0" />
        <span className="translate-y-[0.5px]">{label}</span>
      </button>
    </div>
  );
}

/**
 * 入场动画账本（模块级，app 生命周期）：
 * - 只对「运行中尾部追加的行」播 150ms 软淡入（Cindy detail-soft-in 语义：0.4→1
 *   浮现，不是从 0 起——软化「突然就位」，不制造位移）；
 * - 历史装载/切会话重建（0→N 大批量）不播——整块浮现由外层 FadeSwitcher 负责；
 * - 已入场的行进 seen 集，虚拟滚动回收重挂不重播。
 */
const enteredRows = new Set<string>();
/** enteredRows 归属会话（模块级）：切会话整体清空；同会话内不清（虚拟化重挂不重播靠它） */
let enteredRowsSession: string | null = null;
/** 一次渲染新增 ≤4 行才算「尾部追加」；更大批次按历史/重建处理 */
const APPEND_BATCH_MAX = 4;

export function MessageStream({
  slice,
  workDir,
  onOpenFile,
  canFork,
  onFork,
  onAddToChat,
  onDelete,
  onRewind,
  onRetryError,
  onEditStart,
  onEditSubmit,
  onDeleteUserMessage,
  artifactPaths,
  turnChangesSlot,
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
  // 编辑入口只给最后一条 user 消息（Cindy edit-last-message）
  let lastUserId = '';
  for (const it of slice.items) if (it.kind === 'user') lastUserId = it.id;
  // 虚拟化行 = 分组行 + 流式未封口伪行（永远最后一行）
  const rows = useMemo<Array<GroupedRow | { kind: 'streaming'; id: string }>>(
    () => (slice.streamingText ? [...grouped, { kind: 'streaming', id: '__streaming__' }] : grouped),
    [grouped, slice.streamingText],
  );
  // 入场动画：本渲染是否「尾部追加批次」（少量增量；首渲染与 0→N 批量不算）
  const prevRowsLenRef = useRef(0);
  const firstRenderRef = useRef(true);
  const isAppendBatch =
    !firstRenderRef.current &&
    prevRowsLenRef.current > 0 &&
    rows.length > prevRowsLenRef.current &&
    rows.length - prevRowsLenRef.current <= APPEND_BATCH_MAX;
  useEffect(() => {
    firstRenderRef.current = false;
    prevRowsLenRef.current = rows.length;
  });
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
  // 导航条自身的当前项/可见范围判定在 MessageNavRail 内部测量，这里只管 chip。
  const [prevQuestion, setPrevQuestion] = useState<{ index: number; preview: string } | null>(null);
  const userIndexes = useMemo(() => {
    const idx: number[] = [];
    grouped.forEach((g, i) => {
      if (g.kind === 'user') idx.push(i);
    });
    return idx;
  }, [grouped]);
  const rafPendingRef = useRef(false);
  const updateScrollProbes = (): void => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const el = containerRef.current;
      if (!el || rows.length === 0) {
        setPrevQuestion(null);
        return;
      }
      // 视口首个真实相交行（getVirtualItems 含 overscan 外扩，剥掉）
      const viewTop = el.scrollTop + 4;
      let firstVisible = -1;
      for (const it of virtualizer.getVirtualItems()) {
        if (it.end >= viewTop) {
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
      setPrevQuestion({ index: prev, preview: promptPreviewLine(item.text) });
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

  // ── Cindy message-nav-rail ──
  // 条目覆盖全量已加载 items（导航条要给整段历史画刻度）；目标可能在虚拟渲染
  // 窗口外，跳转走下面的两段式 layout effect：先 scrollToIndex 扩窗，下一轮再
  // 按 Cindy 落点（提问顶边停在容器顶下方 12px）平滑精滚。
  const navRail = useMemo(() => {
    const entries = deriveNavRailEntries(slice.items);
    // 条目 → 虚拟行下标（两者同为文档序，双指针一次对齐）
    const rowIndexes: number[] = [];
    let r = 0;
    for (const e of entries) {
      while (r < rows.length && rows[r]!.id !== e.id) r++;
      rowIndexes.push(r < rows.length ? r : -1);
    }
    return { entries, rowIndexes };
  }, [slice.items, rows]);
  const navRailEntries = navRail.entries;

  // 入口去重：导航条完整覆盖导航（出场且刻度未截断）时抑制「跳到上一条提问」
  // chip —— 同一个导航任务只保留一套入口；导航条缺席或截断了更早刻度时 chip
  // 回归兜底。
  const [navRailCoversNav, setNavRailCoversNav] = useState(false);

  // 条目相对虚拟渲染窗口的方位：TanStack 是居中窗口（Cindy 是「锚点→末尾」
  // 后缀切片，未挂载必在视口上方），未挂载可能在视口下方 —— 喂给 rail 的 top
  // 序列必须单调，下方的未挂载条目由 rail 记 +∞。
  const navRailRowIndexes = navRail.rowIndexes;
  const getNavRailEntrySide = useCallback(
    (entryIndex: number): 'above' | 'below' | null => {
      const rowIndex = navRailRowIndexes[entryIndex];
      if (rowIndex === undefined || rowIndex < 0) return null;
      const range = virtualizer.range;
      if (!range) return null;
      if (rowIndex < range.startIndex) return 'above';
      if (rowIndex > range.endIndex) return 'below';
      return null;
    },
    [navRailRowIndexes, virtualizer],
  );

  // 切会话重置 rail 几何/pending 态（FadeSwitcher 不重挂子树，靠 resetKey）
  const [streamSessionId, setStreamSessionId] = useState<string | null>(() => getFocusedSessionId());

  // 导航条跳转：点击即离开尾部的明确意图 —— 同步解除贴底（防精滚期间 RO 跟底
  // 把视口拽回底部），再发 request 进 layout effect 精滚。
  const railJumpSeqRef = useRef(0);
  const [railJumpRequest, setRailJumpRequest] = useState<{ id: string; seq: number } | null>(null);
  const lastAppliedRailJumpRef = useRef(0);
  const unpinRef = useRef(unpin);
  unpinRef.current = unpin;
  const handleNavRailJump = useCallback(
    (clientId: string): void => {
      unpinRef.current();
      railJumpSeqRef.current += 1;
      setRailJumpRequest({ id: clientId, seq: railJumpSeqRef.current });
    },
    [],
  );

  useLayoutEffect(() => {
    const req = railJumpRequest;
    if (!req || lastAppliedRailJumpRef.current === req.seq) return;
    const index = rows.findIndex((r) => r.id === req.id);
    if (index < 0) {
      // 条目派生自 items，拿不到行只可能是消息刚被删 — 放弃本次跳转。
      lastAppliedRailJumpRef.current = req.seq;
      return;
    }
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector(
      `[data-message-client-id="${CSS.escape(req.id)}"]`,
    ) as HTMLElement | null;
    if (!el) {
      // 目标在虚拟渲染窗口外：先瞬时把窗口锚到目标行（scrollToIndex 即扩窗），
      // 滚动后虚拟行变化触发重渲，本 effect 重跑走下面的精滚分支。
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' });
      return;
    }
    lastAppliedRailJumpRef.current = req.seq;
    // 落点手动计算（Cindy 同款）：提问顶边停在容器顶下方 12px，视口恰好框住
    // 整轮「提问 → 回答」，不走 scrollIntoView。
    const targetTop =
      root.scrollTop +
      (el.getBoundingClientRect().top - root.getBoundingClientRect().top) -
      NAV_RAIL_JUMP_TOP_OFFSET_PX;
    root.scrollTo({ top: Math.max(0, targetTop), behavior: reducedMotion ? 'auto' : 'smooth' });
  });

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
    // 右上角「上一条提问」跳钮 + 导航器高亮探测（rAF 节流）
    updateScrollProbes();
  };

  // 切会话后重估「上一条提问」跳钮与导航器高亮（视口内容变了）
  useEffect(() => {
    updateScrollProbes();
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

  // 切会话清空入场账本（focusedSessionId 由 ChatPage 切会话时 markSessionSeen 更新，
  // 可能晚一拍——新会话的行 id 本不在账本里，晚清不影响正确性）；
  // 同时驱动导航条 resetKey（FadeSwitcher 不重挂子树，rail 内部几何/pending 态靠它归零）
  useEffect(() => {
    const sid = getFocusedSessionId();
    if (sid !== null && sid !== enteredRowsSession) {
      enteredRowsSession = sid;
      enteredRows.clear();
    }
    setStreamSessionId(sid);
  });

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
          const item = rows[vr.index]!;          // 入场账本：追加批次里首次出现的行播一次软淡入（幂等登记，重挂不重播；
          // __streaming__ 伪行 id 常量，天然只播首次——流式本身即动效，跳过）
          const rowEnter =
            item.kind !== 'streaming' &&
            isAppendBatch &&
            !enteredRows.has(item.id) &&
            (enteredRows.add(item.id), true);
          // 用户消息的分享配对：向后找第一条 assistant 回复
          let userShareReply: string | undefined;
          if (item.kind === 'user') {
            for (let j = vr.index + 1; j < rows.length; j++) {
              const r = rows[j]!;
              if (r.kind === 'assistant') {
                userShareReply = r.text;
                break;
              }
            }
          }
          return (
            <div
              key={vr.key}
              data-index={vr.index}
              data-virtual
              // 行锚点：消息导航条/跳转按 [data-message-client-id] 查询行元素
              data-message-client-id={item.id}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${vr.start}px)` }}
            >
              {/* 行间距内化为行内 padding（绝对定位下容器 gap 失效） */}
              <div className={cn('pb-3.5', rowEnter && 'animate-row-enter')}>
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
                  <UserTurn
                    item={item}
                    canFork={canFork}
                    onFork={onFork}
                    canEdit={item.id === lastUserId && Boolean(onEditSubmit)}
                    onEditStart={onEditStart}
                    onEditSubmit={onEditSubmit}
                    onRewind={onRewind}
                    onShare={
                      userShareReply !== undefined
                        ? () =>
                            setSharePayload({
                              userText: item.text,
                              assistantText: userShareReply,
                              createdAt: item.createdAt,
                            })
                        : undefined
                    }
                    onDeleteUserMessage={
                      onDeleteUserMessage && item.createdAt
                        ? () => {
                            const ts = item.createdAt;
                            if (ts !== undefined) onDeleteUserMessage(ts);
                          }
                        : undefined
                    }
                    workDir={workDir}
                    onOpenFile={onOpenFile}
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
                    artifactPaths={artifactPaths}
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
        {/* 轮末改动卡：作为对话内容渲染在最后一轮回复下方（跟内容滚动，不浮在视口） */}
        {turnChangesSlot ? <div className="mt-1.5">{turnChangesSlot}</div> : null}
      </div>
      {sharePayload ? (
        <ShareTurnModal payload={sharePayload} onClose={() => setSharePayload(null)} />
      ) : null}
      </div>
      {/* 右上角「跳到上一条提问」（icon-only 圆钮，对齐 Cindy；hover 预览问题原文）。
          导航条完整覆盖导航时不挂（入口去重，见 navRailCoversNav） */}
      {prevQuestion && !navRailCoversNav && (
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
      {/* Cindy message-nav-rail：左缘提问导航条（每条提问一根刻度，当前阅读轮
          加深，hover 预览提问 + 回答摘要，点击跳回那一轮；≥4 轮且左留白足够才
          出场，窄窗口自然隐藏；悬停刻度带时滚轮重派+转发回滚动容器） */}
      <MessageNavRail
        entries={navRailEntries}
        scrollRef={containerRef}
        contentMaxWidth={820}
        bottomOffset={0}
        onJump={handleNavRailJump}
        onNavCoverageChange={setNavRailCoversNav}
        resetKey={streamSessionId ?? undefined}
        getEntryWindowSide={getNavRailEntrySide}
      />
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
