/**
 * ChatInput —— composer 卡片（复刻 Cindy new-chat/ChatInput.tsx 的壳层解剖）。
 *
 * 形态：Card 底 + 1px Board + 12px 圆角的抬升输入卡；聚焦时描边换
 * --text-muted（chat-input-border-focus 语义，灰度聚焦提示，不用 focus ring）。
 * 内部两段：textarea 编辑区（px-[11px] pt-[11px]，min-h-[86px]）+ 底部工具行
 * （左：权限 chip 等 leadingControls；右：模型 chip（modelControl）+ SendButton）。
 * Enter 发送 / Shift+Enter 换行 / IME 组词期间 Enter 不发送（§14.3）。
 * 附件：回形针选择 + 粘贴图片/文件；拖入由外层会话列承接。
 */
import { useMemo, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { SendButton } from './SendButton';
import { SlashPalette, type SlashItem } from './SlashPalette';
import type { SessionAttachment } from '../../../shared/fundet-api.ts';
import { fileKind } from '../../../shared/file-kind.ts';

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  isRunning: boolean;
  /** 禁用整个输入区（含 textarea） */
  disabled?: boolean;
  /** 只禁用发送（无可用模型等场景：可以打字，不能发 —— 对齐 cindy-09） */
  sendDisabled?: boolean;
  placeholder?: string;
  /** 工具行左侧控件（权限选择器 chip 等） */
  leadingControls?: React.ReactNode;
  /** 工具行右侧控件（模型选择器 chip，SendButton 之前） */
  trailingControls?: React.ReactNode;
  slashItems?: SlashItem[];
  attachments?: SessionAttachment[];
  onRemoveAttachment?: (path: string) => void;
  onAddFiles?: (files: File[]) => void;
  onPickFiles?: () => void;
  dragOver?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onAbort,
  isRunning,
  disabled,
  sendDisabled,
  placeholder = `Hi ${brand.name}!`,
  leadingControls,
  trailingControls,
  slashItems = [],
  attachments = [],
  onRemoveAttachment,
  onAddFiles,
  onPickFiles,
  dragOver,
}: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const autoResize = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const canSend =
    (value.trim().length > 0 || attachments.length > 0) && !disabled && !sendDisabled && !isRunning;

  const slashQuery = useMemo(() => {
    const t = value;
    if (/^\/skill:[^\s]*$/.test(t)) return { kind: 'skill' as const, q: t.slice('/skill:'.length) };
    if (/^\/[^\s]*$/.test(t) && !t.startsWith('/skill:')) {
      return { kind: 'skill' as const, q: t.slice(1) };
    }
    return null;
  }, [value]);

  const filtered = useMemo(() => {
    if (!slashQuery) return [];
    const q = slashQuery.q.toLowerCase();
    return slashItems
      .filter((it) => it.kind === slashQuery.kind)
      .filter(
        (it) =>
          !q ||
          it.label.toLowerCase().includes(q) ||
          it.insert.toLowerCase().includes(q) ||
          it.hint.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [slashItems, slashQuery]);

  const pick = (item: SlashItem): void => {
    onChange(`${item.insert} `);
    setActiveIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div
      className={cn(
        'relative flex w-full flex-col rounded-container border transition-colors',
        'border-board bg-card',
        'focus-within:border-[var(--input-focus-border)]',
        dragOver && 'border-[var(--focus-ring)]',
      )}
    >
      {slashQuery && (
        <SlashPalette
          items={filtered}
          activeIndex={Math.min(activeIndex, Math.max(filtered.length - 1, 0))}
          onHover={setActiveIndex}
          onPick={pick}
        />
      )}
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-container border-2 border-dashed border-[var(--focus-ring)]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--focus-ring) 12%, transparent)' }}
        >
          <div className="flex h-full items-center justify-center text-13 text-primary">
            放到这里，发给助手
          </div>
        </div>
      )}
      <div className="relative flex max-h-[300px] min-h-[86px] w-full flex-col justify-between px-[11px] pt-[11px] pb-[6px]">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.path}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-board bg-chip py-0.5 pl-2 pr-1 text-11 text-secondary"
                title={a.path}
              >
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="text-10 text-muted">{fileKind(a.path)}</span>
                {onRemoveAttachment && (
                  <button
                    type="button"
                    title="移除"
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-hover hover:text-primary"
                    onClick={() => onRemoveAttachment(a.path)}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setActiveIndex(0);
            autoResize();
          }}
          onPaste={(e) => {
            const dt = e.clipboardData;
            if (!dt || !onAddFiles) return;
            const files: File[] = [];
            for (const item of Array.from(dt.items ?? [])) {
              if (item.kind === 'file') {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length === 0) files.push(...Array.from(dt.files ?? []));
            if (files.length === 0) return;
            const hasText = Boolean(dt.getData('text/plain'));
            if (!hasText) e.preventDefault();
            onAddFiles(files);
          }}
          onKeyDown={(e) => {
            if (slashQuery && filtered.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filtered.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                pick(filtered[Math.min(activeIndex, filtered.length - 1)]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onChange('');
                return;
              }
            }
            // Enter 发送 / Shift+Enter 换行；IME 组词期间的 Enter 不算发送（§14.3）
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className={cn(
            'max-h-[200px] min-h-[24px] w-full flex-1 resize-none bg-transparent text-14 text-primary',
            'placeholder:text-placeholder outline-none focus:outline-none focus-visible:outline-none',
          )}
        />

        {/* 底部工具行：左侧 chip 组 / 右侧 chip + 发送 */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 shrink items-center gap-2">
            {onPickFiles && (
              <button
                type="button"
                title="添加文件"
                disabled={disabled}
                onClick={onPickFiles}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary disabled:opacity-40"
              >
                <Paperclip size={14} />
              </button>
            )}
            {leadingControls}
          </div>
          <div className="flex min-w-0 shrink items-center justify-end gap-2">
            {trailingControls}
            {isRunning ? (
              <SendButton disabled={false} onClick={onAbort} isStreaming />
            ) : (
              <SendButton disabled={!canSend} onClick={onSend} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
