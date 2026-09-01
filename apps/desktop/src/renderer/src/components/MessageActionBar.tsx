import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Ellipsis, MessageSquarePlus, Share, Split, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn';

export interface TurnUsage {
  tokenUsage: number;
  contextTokens: number;
  costUsd: number;
}

function formatRelative(ts: number): string {
  const d = Date.now() - ts;
  if (d < 45_000) return '刚刚';
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`;
  if (d < 86_400_000) return `${Math.max(1, Math.round(d / 3_600_000))} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}k`;
  }
  return String(n);
}

const ICON_BTN =
  'group flex h-6 w-6 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-hover hover:text-primary disabled:opacity-40';

export function MessageActionBar({
  createdAt,
  copyText,
  usage,
  hovered,
  pinned,
  onShare,
  onFork,
  onAddToChat,
  onDelete,
}: {
  createdAt?: number;
  copyText: string;
  usage?: TurnUsage;
  hovered: boolean;
  /** 本轮刚完成：操作栏常显，不必等悬停 */
  pinned?: boolean;
  onShare?: () => void;
  onFork?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [forking, setForking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = hovered || menuOpen || Boolean(pinned);

  useEffect(() => {
    if (!copied && !copyError) return;
    const t = window.setTimeout(() => {
      setCopied(false);
      setCopyError(false);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [copied, copyError]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const copy = useCallback(async (text: string) => {
    try {
      await window.fundet.copyText(text);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }, []);

  const tokens = usage && usage.tokenUsage > 0 ? usage.tokenUsage : 0;
  const tooltip = usage
    ? [
        `Token：共 ${formatCompactTokens(usage.tokenUsage)}`,
        usage.contextTokens > 0 ? `上下文 ${formatCompactTokens(usage.contextTokens)}` : null,
        usage.costUsd > 0 ? `费用 $${usage.costUsd.toFixed(4)}` : '本轮费用暂不可用，仅显示用量',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const hasMore = Boolean(onAddToChat || onDelete);

  return (
    <div
      ref={rootRef}
      className={cn(
        'mt-1 flex h-6 items-center gap-0.5 transition-opacity duration-150',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <button
        type="button"
        className={ICON_BTN}
        title={copyError ? '复制失败' : copied ? '已复制' : '复制'}
        aria-label="复制"
        onClick={() => void copy(copyText)}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {onShare ? (
        <button type="button" className={ICON_BTN} title="分享为图片" aria-label="分享为图片" onClick={onShare}>
          <Share size={14} />
        </button>
      ) : null}
      {onFork ? (
        <button
          type="button"
          className={ICON_BTN}
          title="分叉到新会话"
          aria-label="分叉到新会话"
          disabled={forking}
          onClick={() => {
            if (forking) return;
            setForking(true);
            void onFork().finally(() => setForking(false));
          }}
        >
          <Split size={14} />
        </button>
      ) : null}
      {hasMore ? (
        <div className="relative">
          <button
            type="button"
            className={ICON_BTN}
            title="更多"
            aria-label="更多"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Ellipsis size={14} />
          </button>
          {menuOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1 w-[180px] rounded-xl border border-board bg-card p-1 shadow-[var(--shadow-menu)]">
              {onAddToChat ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-13 text-primary hover:bg-hover"
                  onClick={() => {
                    onAddToChat();
                    setMenuOpen(false);
                  }}
                >
                  <MessageSquarePlus size={14} />
                  添加到对话
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-13 text-error hover:bg-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    void onDelete();
                  }}
                >
                  <Trash2 size={14} />
                  删除本条消息
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {createdAt ? (
        <span className="ml-1.5 text-12 text-muted" title={new Date(createdAt).toLocaleString('zh-CN')}>
          {formatRelative(createdAt)}
        </span>
      ) : null}
      {tokens > 0 ? (
        <span className="ml-1.5 cursor-default text-12 text-muted" title={tooltip}>
          {formatCompactTokens(tokens)} tokens
        </span>
      ) : null}
    </div>
  );
}
