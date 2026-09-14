/**
 * FindBar — 页内搜索条（Ctrl+F，对齐浏览器/Cindy 的 find-in-page 形态）。
 *
 * 走 Electron 原生 webContents.findInPage：渲染层全文高亮白拿；结果计数经
 * find:result push 回流。Enter/↓ 下一个、Shift+Enter/↑ 上一个、Esc 关闭并
 * 清除高亮；Aa 切换大小写敏感。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '../lib/cn';

export function FindBar({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [result, setResult] = useState<{ active: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const caseRef = useRef(matchCase);
  caseRef.current = matchCase;

  useEffect(() => {
    if (!open) return undefined;
    return window.fundet.onFindResult((r) => {
      if (r.finalUpdate) setResult({ active: r.activeMatchOrdinal, total: r.matches });
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      setResult(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
    return undefined;
  }, [open]);

  // 关闭时清高亮
  useEffect(
    () => () => {
      void window.fundet.stopFindInPage();
    },
    [],
  );

  if (!open) return null;

  const run = (opts?: { findNext?: boolean; forward?: boolean }): void => {
    const q = text.trim();
    if (!q) {
      void window.fundet.stopFindInPage();
      setResult(null);
      return;
    }
    void window.fundet.findInPage(q, { ...opts, matchCase: caseRef.current });
  };

  const close = (): void => {
    void window.fundet.stopFindInPage();
    onClose();
  };

  return (
    <div className="absolute top-1 right-4 z-50 flex h-9 items-center gap-1 rounded-full border border-board bg-card pl-3 pr-1 shadow-[var(--shadow-menu)]">
      <input
        ref={inputRef}
        value={text}
        placeholder="在页面中查找…"
        onChange={(e) => {
          setText(e.target.value);
          // 输入变化即重新搜（150ms 去抖，避免每键一搜）
          window.clearTimeout((inputRef.current as HTMLInputElement & { _t?: number })._t);
          (inputRef.current as HTMLInputElement & { _t?: number })._t = window.setTimeout(
            () => run(),
            150,
          );
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run({ findNext: true, forward: !e.shiftKey });
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        className="w-[180px] bg-transparent text-13 text-primary outline-none placeholder:text-muted"
      />
      <button
        type="button"
        title={matchCase ? '区分大小写：开' : '区分大小写：关'}
        onClick={() => {
          setMatchCase((v) => !v);
          // 切换后立即按新档重搜
          window.setTimeout(() => run(), 0);
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-12 font-medium transition-colors',
          matchCase ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover hover:text-primary',
        )}
      >
        Aa
      </button>
      <span className="min-w-[52px] text-center text-12 tabular-nums text-muted select-none">
        {result && result.total > 0 ? `${result.active}/${result.total}` : text ? '无结果' : ''}
      </span>
      <button
        type="button"
        aria-label="上一个"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
        onClick={() => run({ findNext: true, forward: false })}
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        aria-label="下一个"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
        onClick={() => run({ findNext: true, forward: true })}
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        aria-label="关闭搜索"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
        onClick={close}
      >
        <X size={13} />
      </button>
    </div>
  );
}
