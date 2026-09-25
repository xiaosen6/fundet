import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Ellipsis,
  Loader2,
  MessageSquarePlus,
  Pen,
  Share,
  Split,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip } from './ui/Tooltip';
import { toast } from './ui/toast';

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
  speakText,
  onFork,
  onAddToChat,
  onDelete,
  onEdit,
  onRewind,
  align = 'right',
}: {
  createdAt?: number;
  copyText: string;
  usage?: TurnUsage;
  hovered: boolean;
  /** 本轮刚完成：操作栏常显，不必等悬停 */
  pinned?: boolean;
  /** 朗读文本（assistant 文本消息传入；0.3.14 网关 TTS） */
  speakText?: string;
  onShare?: () => void;
  onFork?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
  /** 编辑该条消息（用户消息用：进 composer 编辑态，发送截断重发） */
  onEdit?: () => void;
  /** 回滚工作目录文件（用户消息用：收进「更多」菜单，对齐 Cindy） */
  onRewind?: () => void;
  /** 对齐侧：right=user（时间在最前）/ left=assistant（时间与用量靠后）——Cindy 双序 */
  align?: 'left' | 'right';
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  // 朗读：合成中 spinner / 播放中可停（同一按钮三态）
  const [speaking, setSpeaking] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking('idle');
  }, []);
  useEffect(() => () => stopSpeaking(), [stopSpeaking]);
  const toggleSpeak = useCallback(() => {
    if (speaking !== 'idle') {
      stopSpeaking();
      return;
    }
    if (!speakText?.trim()) return;
    setSpeaking('loading');
    void window.fundet
      .voiceSpeak(speakText)
      .then(({ wavBase64 }) => {
        const audio = new Audio(`data:audio/wav;base64,${wavBase64}`);
        audioRef.current = audio;
        audio.onended = () => {
          audioRef.current = null;
          setSpeaking('idle');
        };
        audio.play().catch(() => setSpeaking('idle'));
        setSpeaking('playing');
      })
      .catch((err: unknown) => {
        setSpeaking('idle');
        toast.error(err instanceof Error ? err.message : '朗读失败');
      });
  }, [speakText, speaking, stopSpeaking]);
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

  const timeEl = createdAt ? (
    <Tooltip label={new Date(createdAt).toLocaleString('zh-CN')} side="top">
      <span className="mr-1 text-12 text-muted">{formatRelative(createdAt)}</span>
    </Tooltip>
  ) : null;

  // Rewind 只在 user 侧（align right）收进菜单（Cindy：canRewind = align === 'right'）
  const canRewind = Boolean(onRewind && align === 'right');
  const hasMore = Boolean(onAddToChat || canRewind || onDelete);

  return (
    <div
      ref={rootRef}
      className={cn(
        'mt-1 flex h-6 items-center gap-0.5 transition-opacity duration-[var(--motion-fast)]',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* 时间位置按对齐侧（Cindy 双序）：user 在最前 / assistant 靠后 */}
      {align === 'right' && createdAt ? timeEl : null}
      <Tooltip label={copyError ? '复制失败' : copied ? '已复制' : '复制'} side="top">
        <button
          type="button"
          className={ICON_BTN}
          aria-label="复制"
          onClick={() => void copy(copyText)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </Tooltip>
      {speakText ? (
        <Tooltip label={speaking === 'playing' ? '停止朗读' : speaking === 'loading' ? '合成中…' : '朗读'} side="top">
          <button
            type="button"
            className={ICON_BTN}
            aria-label="朗读"
            onClick={toggleSpeak}
            disabled={speaking === 'loading'}
          >
            {speaking === 'playing' ? (
              <VolumeX size={14} />
            ) : speaking === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Volume2 size={14} />
            )}
          </button>
        </Tooltip>
      ) : null}
      {onShare ? (
        <Tooltip label="分享为图片" side="top">
          <button type="button" className={ICON_BTN} aria-label="分享为图片" onClick={onShare}>
            <Share size={14} />
          </button>
        </Tooltip>
      ) : null}
      {onFork ? (
        <Tooltip label="分叉到新会话" side="top">
          <button
            type="button"
            className={ICON_BTN}
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
        </Tooltip>
      ) : null}
      {onEdit ? (
        <Tooltip label="编辑" side="top">
          <button type="button" className={ICON_BTN} aria-label="编辑" onClick={onEdit}>
            <Pen size={14} />
          </button>
        </Tooltip>
      ) : null}
      {hasMore ? (
        <div className="relative">
          <Tooltip label="更多" side="top">
            <button
              type="button"
              className={ICON_BTN}
              aria-label="更多"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Ellipsis size={14} />
            </button>
          </Tooltip>
          {menuOpen && (
            <div
              className={cn(
                'absolute bottom-full z-20 mb-1 min-w-[184px] rounded-xl border border-board bg-card p-1 shadow-[var(--shadow-menu)]',
                align === 'right' ? 'right-0' : 'left-0',
              )}
            >
              {onAddToChat ? (
                <button
                  type="button"
                  className="flex h-8 w-full items-center rounded-lg px-2 text-left text-13 text-primary hover:bg-hover"
                  onClick={() => {
                    onAddToChat();
                    setMenuOpen(false);
                  }}
                >
                  <MessageSquarePlus size={14} className="mr-2 shrink-0" />
                  添加到对话
                </button>
              ) : null}
              {canRewind ? (
                <button
                  type="button"
                  className="flex h-8 w-full items-center rounded-lg px-2 text-left text-13 text-primary hover:bg-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    onRewind?.();
                  }}
                >
                  <Undo2 size={14} className="mr-2 shrink-0" />
                  回滚
                </button>
              ) : null}
              {onDelete ? (
                <>
                  {(onAddToChat || canRewind) && <div className="my-1 h-px bg-board" />}
                  <button
                    type="button"
                    className="flex h-8 w-full items-center rounded-lg px-2 text-left text-13 text-error hover:bg-hover"
                    onClick={() => {
                      setMenuOpen(false);
                      void onDelete();
                    }}
                  >
                    <Trash2 size={14} className="mr-2 shrink-0" />
                    删除本条消息
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {align === 'left' && timeEl}
      {tokens > 0 ? (
        <Tooltip label={tooltip} side="top">
          <span className="ml-1.5 cursor-default text-12 text-muted">
            {formatCompactTokens(tokens)} tokens
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
