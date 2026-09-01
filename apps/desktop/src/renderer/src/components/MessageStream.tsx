/**
 * MessageStream — 消息滚动容器。
 *
 * 自动贴底：用户上滑超过阈值则暂停贴底（回读到底部恢复），新内容到来时
 * 只有处于贴底态才滚动。渲染 slice.items + 未封口的流式文本。
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
import { AlertCircle, Info } from 'lucide-react';
import type { DisplayItem, SessionSlice } from '../stores/sessionStore';
import { AssistantMessage } from './AssistantMessage';
import { MessageActionBar } from './MessageActionBar';
import { ShareTurnModal, type ShareTurnPayload } from './ShareTurnModal';
import { groupWorkItems, WorkGroupBlock } from './WorkGroupBlock';

/** 距底部多少 px 内视为贴底 */
const STICK_THRESHOLD = 48;

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
}: {
  item: AssistantItem;
  pinned: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  onShare?: () => void;
  onFork?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex justify-start"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-full max-w-full min-w-0">
        <AssistantMessage text={item.text} workDir={workDir} onOpenFile={onOpenFile} />
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
  const stickRef = useRef(true);
  const [sharePayload, setSharePayload] = useState<ShareTurnPayload | null>(null);
  const grouped = useMemo(
    () => groupWorkItems(slice.items, slice.isRunning),
    [slice.items, slice.isRunning],
  );
  const hasStreaming = Boolean(slice.streamingText);
  const pinnedId = useMemo(() => {
    if (slice.isRunning || hasStreaming) return null;
    for (let i = grouped.length - 1; i >= 0; i--) {
      const it = grouped[i];
      if (it.kind === 'assistant') return it.id;
    }
    return null;
  }, [grouped, slice.isRunning, hasStreaming]);

  const handleScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

  // 内容变化时贴底（用 useLayoutEffect 避免闪烁）
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [slice.items, slice.streamingText]);

  // 切换会话（items 引用整体替换）时重置贴底
  useEffect(() => {
    stickRef.current = true;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.historyLoaded]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
    >
      <div className="mx-auto flex max-w-[820px] flex-col gap-3.5">
        {slice.items.length === 0 && !slice.streamingText && (
          <div className="pt-24 text-center text-13 text-muted select-none">
            输入消息或拖入文件开始对话
          </div>
        )}

        {grouped.map((item, index) => {
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
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[488px] rounded-container border border-board bg-card px-4 py-3 text-15 leading-[1.6] break-words whitespace-pre-wrap text-primary select-text">
                    {item.attachments && item.attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {item.attachments.map((a) => (
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
                    {item.text}
                  </div>
                </div>
              );
            case 'assistant': {
              const showBar = isTurnTailAssistant(grouped, index, slice.isRunning, hasStreaming);
              if (!showBar) {
                return (
                  <div key={item.id} className="flex justify-start">
                    <div className="w-full max-w-full min-w-0">
                      <AssistantMessage text={item.text} workDir={workDir} onOpenFile={onOpenFile} />
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
  );
}
