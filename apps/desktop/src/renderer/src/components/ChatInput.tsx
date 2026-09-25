/**
 * ChatInput —— composer 卡片（复刻 Cindy new-chat/ChatInput.tsx 的壳层解剖）。
 *
 * 形态：Card 底 + 1px Board + 12px 圆角的抬升输入卡；聚焦时描边换
 * --text-muted（chat-input-border-focus 语义，灰度聚焦提示，不用 focus ring）。
 * 内部两段：textarea 编辑区（px-[11px] pt-[11px]，min-h-[86px]）+ 底部工具行
 * （左：权限 chip 等 leadingControls；右：模型 chip（modelControl）+ SendButton）。
 * Enter 发送 / Shift+Enter 换行 / IME 组词期间 Enter 不发送（§14.3）。
 * 附件：回形针选择 + 粘贴图片/文件；拖入由外层会话列承接；图片附件带缩略图。
 * @ 引用：输入 @ 唤出工作目录文件候选（FileMentionPanel），选中 stage 成附件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Mic, Paperclip, Square, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { toast } from './ui/toast';
import { SendButton } from './SendButton';
import { SlashPalette, type SlashItem } from './SlashPalette';
import { FileMentionPanel, useDirEntries } from './FileMentionPanel';
import { AttachmentThumb } from './AttachmentThumb';
import type { SessionAttachment } from '../../../shared/fundet-api.ts';
import { fileKind } from '../../../shared/file-kind.ts';
import { Tooltip } from './ui/Tooltip';
import { showLightbox } from './ui/Lightbox';

export interface PastedTextChip {
  id: number;
  text: string;
  lines: number;
}

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
  /** 粘贴长文本收成的 chip（Cindy 同款：不糊输入框，发送时展开为原文） */
  pastedTexts?: PastedTextChip[];
  onPasteLongText?: (text: string, lines: number) => void;
  onRemovePastedText?: (id: number) => void;
  /** @ 文件引用：工作目录 + 选中路径的 stage 回调（两者都给才启用） */
  workDir?: string;
  onStagePaths?: (paths: string[]) => void;
  /** 运行中按 Enter：把纯文本排队（本轮结束后自动发送）；带附件时不排队 */
  onQueue?: (text: string) => void;
  /** 高体量（Cindy 首页空态 150px 多行卡）；对话态缺省为扁输入框（~86px，打字长高） */
  tall?: boolean;
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
  pastedTexts = [],
  onPasteLongText,
  onRemovePastedText,
  workDir,
  onStagePaths,
  onQueue,
  tall = false,
}: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  /** @ 引用态：tokenStart 含 '@' 字符的位置；query 是 @ 后的路径串 */
  const [mention, setMention] = useState<{ query: string; tokenStart: number } | null>(null);

  // 语音输入（0.3.14）：常显（用户拍板不设开关）；转写文本插到光标处
  const voiceEnabled = true as const;
  const insertAtCursor = useCallback(
    (text: string): void => {
      const el = textareaRef.current;
      const caret = el ? (el.selectionStart ?? value.length) : value.length;
      const before = value.slice(0, caret);
      const after = value.slice(caret);
      const glue = before && !/\s$/.test(before) ? ' ' : '';
      onChange(`${before}${glue}${text} ${after}`);
      requestAnimationFrame(() => {
        const pos = (before + glue + text).length + 1;
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [onChange, value],
  );
  const voice = useVoiceInput(insertAtCursor);
  useEffect(() => {
    if (voice.error) toast.error(voice.error);
  }, [voice.error]);

  const autoResize = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // 程序化改值（草稿恢复/引用插入/发送后清空）也同步高度；挂载时跑一次定初值
  useEffect(() => {
    autoResize();
  }, [value]);

  const canSend =
    (value.trim().length > 0 || attachments.length > 0 || pastedTexts.length > 0) &&
    !disabled &&
    !sendDisabled &&
    !isRunning;

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

  // ---- @ 文件引用 ----
  // 光标前是「@起头的无空格 token」即激活（输入/删改时检测；支持 @dir/sub/ 过滤）
  const mentionEnabled = Boolean(workDir && onStagePaths);
  const detectMention = (text: string, caret: number): void => {
    if (!mentionEnabled) {
      setMention(null);
      return;
    }
    const m = text.slice(0, caret).match(/(?:^|\s)@([^\s]*)$/);
    setMention(m ? { query: m[1] ?? '', tokenStart: caret - (m[1]?.length ?? 0) - 1 } : null);
    setMentionActiveIndex(0);
  };

  const mentionCtx = useMemo(() => {
    if (!mention || !workDir) return null;
    const q = mention.query;
    const slash = q.lastIndexOf('/');
    const dirPart = slash >= 0 ? q.slice(0, slash) : '';
    const filter = slash >= 0 ? q.slice(slash + 1) : q;
    const root = workDir.replace(/[\\/]+$/, '');
    return { baseDir: dirPart ? `${root}/${dirPart}` : root, filter, root, dirPart };
  }, [mention, workDir]);

  const dirEntries = useDirEntries(mentionCtx?.baseDir ?? null);
  const mentionCandidates = useMemo(() => {
    const list = dirEntries.entries ?? [];
    const f = (mentionCtx?.filter ?? '').toLowerCase();
    return list.filter((e) => !f || e.name.toLowerCase().includes(f)).slice(0, 30);
  }, [dirEntries.entries, mentionCtx?.filter]);

  const pickMentionDir = (name: string): void => {
    if (!mention || !mentionCtx) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const token = `@${mention.query}${name}/`;
    onChange(value.slice(0, mention.tokenStart) + token + value.slice(caret));
    setMention({ query: `${mention.query}${name}/`, tokenStart: mention.tokenStart });
    setMentionActiveIndex(0);
    const pos = mention.tokenStart + token.length;
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(pos, pos);
    });
  };

  const pickMentionFile = (name: string): void => {
    if (!mention || !mentionCtx || !onStagePaths) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    onChange(value.slice(0, mention.tokenStart) + value.slice(caret));
    setMention(null);
    onStagePaths([`${mentionCtx.baseDir}/${name}`]);
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
      {mention && mentionCtx && (
        <FileMentionPanel
          entries={dirEntries.entries}
          error={dirEntries.error}
          filter={mentionCtx.filter}
          activeIndex={mentionActiveIndex}
          onHover={setMentionActiveIndex}
          onPickDir={pickMentionDir}
          onPickFile={(entry) => pickMentionFile(entry.name)}
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
      <div className={cn('relative flex max-h-[300px] w-full flex-col justify-between px-[11px] pt-[11px] pb-[6px]', tall ? 'min-h-[150px]' : 'min-h-[72px]')}>
        {/* 粘贴长文本 chip：点击预览全文，× 移除（Cindy「粘贴的文本(N 行)」同款） */}
        {pastedTexts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pastedTexts.map((p) => (
              <span
                key={p.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-board bg-card py-1 pl-2.5 pr-1.5 text-12 text-secondary"
              >
                <button
                  type="button"
                  title={p.text.slice(0, 400)}
                  className="flex min-w-0 items-center gap-1.5"
                  onClick={() =>
                    showLightbox({
                      kind: 'node',
                      label: `粘贴的文本（${p.lines} 行）`,
                      node: (
                        <pre className="max-h-[60vh] max-w-[70vw] overflow-auto whitespace-pre-wrap break-words text-left text-13 leading-[1.6] text-primary">
                          {p.text}
                        </pre>
                      ),
                    })
                  }
                >
                  <FileText size={13} className="shrink-0 text-muted" />
                  <span className="truncate underline decoration-board underline-offset-2">
                    粘贴的文本（{p.lines} 行）
                  </span>
                </button>
                {onRemovePastedText && (
                  <button
                    type="button"
                    title="移除"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-hover hover:text-primary"
                    onClick={() => onRemovePastedText(p.id)}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.path}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-board bg-chip py-0.5 pl-1 pr-1 text-11 text-secondary"
                title={a.path}
              >
                <AttachmentThumb path={a.path} />
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
            detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            autoResize();
          }}
          onPaste={(e) => {
            const dt = e.clipboardData;
            if (!dt) return;
            // 长文本粘贴：收成 chip（Cindy 同款），不糊输入框
            const clipText = dt.getData('text/plain') ?? '';
            const clipLines = clipText ? clipText.split('\n').length : 0;
            if (clipText && onPasteLongText && (clipLines >= 10 || clipText.length > 600)) {
              e.preventDefault();
              onPasteLongText(clipText, clipLines);
              return;
            }
            if (!onAddFiles) return;
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
            // @ 引用面板开着：导航/回车/退出优先给面板（同 slash 语义）
            if (mention && mentionCtx) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionActiveIndex((i) => (i + 1) % Math.max(mentionCandidates.length, 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionActiveIndex(
                  (i) => (i - 1 + Math.max(mentionCandidates.length, 1)) % Math.max(mentionCandidates.length, 1),
                );
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                const hit = mentionCandidates[Math.min(mentionActiveIndex, mentionCandidates.length - 1)];
                if (hit) {
                  e.preventDefault();
                  if (hit.isDir) pickMentionDir(hit.name);
                  else pickMentionFile(hit.name);
                }
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
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
              if (canSend) {
                onSend();
                return;
              }
              // 运行中：纯文本排队（本轮结束后自动发送）；附件/粘贴场景维持原状
              if (
                isRunning
                && onQueue
                && value.trim()
                && attachments.length === 0
                && pastedTexts.length === 0
                && !sendDisabled
                && !disabled
              ) {
                onQueue(value.trim());
              }
            }
          }}
          className={cn(
            // 不用 flex-1：basis-0 会让 flex 算法无视 autoResize 写入的显式高度
            // （曾致长文本不出增高、只出滚动条）；高度由 autoResize 内容驱动，200px 封顶
            'max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-14 text-primary',
            'placeholder:text-placeholder outline-none focus:outline-none focus-visible:outline-none',
          )}
        />

        {/* 底部工具行：左侧 回形针 + 语音 + chip 组（知识库/权限…）/ 右侧 chip + 发送 */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 shrink items-center gap-2">
            {onPickFiles && (
              <Tooltip label="添加文件" side="top">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onPickFiles}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary disabled:opacity-40"
                >
                  <Paperclip size={14} />
                </button>
              </Tooltip>
            )}
            {voiceEnabled && (
              <Tooltip
                label={
                  voice.state === 'recording'
                    ? `录音中 ${voice.seconds}s（点击结束，Esc 取消）`
                    : voice.state === 'transcribing'
                      ? '转写中…'
                      : '语音输入'
                }
                side="top"
              >
                <button
                  type="button"
                  disabled={disabled || voice.state === 'transcribing'}
                  onClick={voice.toggle}
                  aria-label="语音输入"
                  className={cn(
                    'relative flex h-7 items-center justify-center rounded-full transition-colors',
                    'text-muted hover:bg-hover hover:text-primary disabled:opacity-40',
                    voice.state === 'recording' && 'bg-error/10 text-error hover:bg-error/15 hover:text-error',
                    voice.state === 'transcribing' && 'text-secondary',
                  )}
                  style={voice.state === 'idle' ? undefined : { width: 'auto', padding: '0 10px', gap: 6 }}
                >
                  {voice.state === 'recording' ? <Square size={12} /> : <Mic size={14} />}
                  {(voice.state === 'recording' || voice.state === 'transcribing') && (
                    <span className="text-12 tabular-nums">
                      {voice.state === 'recording' ? `${voice.seconds}s` : '转写中'}
                    </span>
                  )}
                  {voice.state === 'recording' && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-error" />
                  )}
                </button>
              </Tooltip>
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
