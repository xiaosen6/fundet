import { useEffect, useRef, useState } from 'react';
import { brand } from '../../../shared/brand.js';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { AssistantMessage } from './AssistantMessage';
import { BrandMark } from './BrandMark';

export interface ShareTurnPayload {
  userText: string;
  assistantText: string;
  createdAt?: number;
}

export function ShareTurnModal({
  payload,
  onClose,
}: {
  payload: ShareTurnPayload;
  onClose: () => void;
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'capturing' | 'copied' | 'error'>('capturing');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setStatus('capturing');
      setError('');
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await new Promise((r) => window.setTimeout(r, 80));
      if (cancelled) return;
      const el = cardRef.current;
      if (!el) {
        setStatus('error');
        setError('找不到分享卡片');
        return;
      }
      const rect = el.getBoundingClientRect();
      try {
        await window.fundet.copyImageRect({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        if (!cancelled) setStatus('copied');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const recapture = (): void => {
    const el = cardRef.current;
    if (!el) return;
    setStatus('capturing');
    setError('');
    const rect = el.getBoundingClientRect();
    void window.fundet
      .copyImageRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })
      .then(() => setStatus('copied'))
      .catch((err: unknown) => {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const dateLabel = payload.createdAt
    ? new Date(payload.createdAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-[var(--overlay-modal)]"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-full flex-col items-center gap-3">
        <div
          ref={cardRef}
          className="w-[560px] max-w-[calc(100vw-48px)] border border-board bg-card px-7 py-6 text-primary"
        >
          <div className="mb-5 flex items-center gap-2">
            <BrandMark size={22} />
            <span className="text-15 font-medium tracking-tight">{brand.name}</span>
          </div>
          {payload.userText.trim() ? (
            <div className="mb-4 flex justify-end">
              <div className="max-w-[420px] rounded-container border border-board bg-surface px-4 py-3 text-14 leading-[1.6] break-words whitespace-pre-wrap">
                {payload.userText}
              </div>
            </div>
          ) : null}
          <div className="max-h-[min(560px,52vh)] overflow-hidden text-14 leading-[1.6]">
            <AssistantMessage text={payload.assistantText} />
          </div>
          {dateLabel ? <div className="mt-5 text-12 text-muted">{dateLabel}</div> : null}
        </div>
        <div className="flex w-full items-center justify-between gap-3 px-1">
          <span className="text-12 text-muted">
            {status === 'capturing'
              ? '正在生成图片…'
              : status === 'copied'
                ? '图片已复制到剪贴板，可直接粘贴分享'
                : `分享失败：${error || '未知错误'}`}
          </span>
          <div className="flex items-center gap-2">
            {status !== 'copied' ? (
              <button
                type="button"
                className="h-8 rounded-full bg-accent px-3 text-12 text-accent-fg"
                onClick={recapture}
              >
                复制图片
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-12 text-primary">
                <Check size={14} />
                已复制
              </span>
            )}
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
              title="关闭"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
