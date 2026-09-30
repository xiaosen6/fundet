/**
 * AskUserQuestionPrompt —— ask_user_question 问答卡（悬挂时替换 composer，机制
 * 对齐 PermissionPrompt；交互手工移植自 Cindy AskUserQuestionPrompt 收敛版）。
 *
 * 多题步进（上一题/跳过）；单选点击即进下一题；多选勾选 + 下一题/提交；
 * 自由输入行统一由宿主提供——模型自造的「其他（回复说明）」式选项经
 * shared/ask-options 剔除（#5198），点击占位标签不再是可提交的答案。
 *
 * 答案编码：单选=选项标签串；多选=JSON 数组串（自定义文本作为追加项）；
 * 跳过=空串。快捷键：数字 1..N 选选项、N+1 展开自由输入、Esc 跳过本题。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { InteractionRequest } from '@fundet/agent-core';
import { visibleAskOptions } from '../../../shared/ask-options.js';
import { shouldCardShortcutYield } from '../lib/card-shortcut-yield.js';

type AskRequest = Extract<InteractionRequest, { kind: 'ask_user_question' }>;
type AskQuestion = AskRequest['questions'][number];

interface AskUserQuestionPromptProps {
  request: AskRequest;
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
}

/** 从已答记录恢复某题选择态（「上一题」回看时不丢进度） */
function selectionFor(
  question: AskQuestion | undefined,
  answer: string | undefined,
): { labels: Set<string>; custom: string; showCustom: boolean } {
  if (!question || answer === undefined) return { labels: new Set(), custom: '', showCustom: false };
  const optionLabels = new Set((question.options ?? []).map((o) => o.label));
  if (question.multiSelect) {
    try {
      const parsed: unknown = JSON.parse(answer);
      if (Array.isArray(parsed)) {
        const custom = (parsed as string[]).find((l) => !optionLabels.has(l)) ?? '';
        return { labels: new Set(parsed as string[]), custom, showCustom: custom !== '' };
      }
    } catch {
      /* 非数组编码按无选择处理 */
    }
    return { labels: new Set(), custom: '', showCustom: false };
  }
  if (answer !== '' && !optionLabels.has(answer)) {
    return { labels: new Set(), custom: answer, showCustom: true };
  }
  return { labels: new Set(), custom: '', showCustom: false };
}

export function AskUserQuestionPrompt({
  request,
  onAnswer,
}: AskUserQuestionPromptProps): React.JSX.Element {
  const { requestId, questions } = request;
  const total = questions.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentQ = questions[currentIndex];
  const isMultiSelect = currentQ?.multiSelect === true;
  const isLast = currentIndex === total - 1;
  const options = visibleAskOptions(currentQ?.options);
  const existingAnswer = currentQ ? answers[currentQ.question] : undefined;

  // 切题（含「上一题」回看）时按已答记录恢复选择态
  useEffect(() => {
    const restored = selectionFor(currentQ, existingAnswer);
    setSelectedLabels(restored.labels);
    setCustomInput(restored.custom);
    setShowCustomInput(restored.showCustom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, requestId]);

  const applySelection = useCallback(
    (idx: number, answersSnapshot: Record<string, string>): void => {
      const restored = selectionFor(questions[idx], answersSnapshot[questions[idx]?.question ?? '']);
      setSelectedLabels(restored.labels);
      setCustomInput(restored.custom);
      setShowCustomInput(restored.showCustom);
    },
    [questions],
  );

  /** 提交本题答案：末题上交全部，否则步进 */
  const advance = useCallback(
    (answer: string): void => {
      const updated = { ...answers, [currentQ.question]: answer };
      setAnswers(updated);
      if (isLast) {
        onAnswer(requestId, updated);
      } else {
        setCurrentIndex(currentIndex + 1);
        applySelection(currentIndex + 1, updated);
      }
    },
    [answers, currentQ, isLast, requestId, onAnswer, currentIndex, applySelection],
  );

  const handleBack = useCallback((): void => {
    if (currentIndex === 0) return;
    setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  /** 多选：提交 = 选中项按展示顺序 + 自定义文本追加，编码为 JSON 数组串 */
  const handleMultiNext = useCallback((): void => {
    if (selectedLabels.size === 0 && !customInput.trim()) return;
    const parts = options.filter((o) => selectedLabels.has(o.label)).map((o) => o.label);
    if (customInput.trim()) parts.push(customInput.trim());
    advance(JSON.stringify(parts));
  }, [selectedLabels, customInput, options, advance]);

  const handleToggle = useCallback((label: string): void => {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const openCustomInput = useCallback((): void => {
    setShowCustomInput(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  /** 单选自由输入提交 */
  const handleCustomSubmit = useCallback((): void => {
    const trimmed = customInput.trim();
    if (!trimmed || isMultiSelect) return;
    advance(trimmed);
    setCustomInput('');
    setShowCustomInput(false);
  }, [customInput, isMultiSelect, advance]);

  // 快捷键：数字选项 / N+1 自由输入 / Esc 跳过；自由输入展开时 Esc 只收起输入。
  // 让位判据（Cindy #5256）：侧栏搜索等别处输入框里打数字、卡片外浮层/控件上的
  // 按键不属于本卡，不能替用户选选项/跳题
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (showCustomInput) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowCustomInput(false);
          setCustomInput('');
        }
        return;
      }
      if (options.length > 0) {
        const num = Number.parseInt(e.key, 10);
        if (num >= 1 && num <= options.length) {
          if (shouldCardShortcutYield(e, 'character', rootRef.current)) return;
          e.preventDefault();
          if (isMultiSelect) handleToggle(options[num - 1]!.label);
          else advance(options[num - 1]!.label);
          return;
        }
        if (num === options.length + 1) {
          if (shouldCardShortcutYield(e, 'character', rootRef.current)) return;
          e.preventDefault();
          openCustomInput();
          return;
        }
      }
      if (e.key === 'Escape') {
        if (shouldCardShortcutYield(e, 'dismiss', rootRef.current)) return;
        e.preventDefault();
        advance('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options, isMultiSelect, showCustomInput, handleToggle, advance, openCustomInput]);

  const nextDisabled = isMultiSelect ? selectedLabels.size === 0 && !customInput.trim() : existingAnswer === undefined;
  const showNext = isMultiSelect || (!isLast && existingAnswer !== undefined);

  return (
    <div ref={rootRef} className="w-full rounded-container border border-board bg-card p-4">
      {/* 标题行：问题 + 多题进度 */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-15 leading-tight font-semibold text-primary">{currentQ?.question}</p>
        {total > 1 && (
          <span className="shrink-0 pt-0.5 text-13 tabular-nums text-muted">
            {currentIndex + 1}/{total}
          </span>
        )}
      </div>

      {/* 选项列表（模型自造自由输入项已剔除，末行是宿主自供输入） */}
      {options.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-inner border border-board">
          {options.map((opt, idx) => (
            <div key={opt.label}>
              {idx > 0 && <div className="h-px bg-board" />}
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover ${
                  !isMultiSelect && existingAnswer === opt.label ? 'bg-hover' : ''
                }`}
                onClick={() => (isMultiSelect ? handleToggle(opt.label) : advance(opt.label))}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {isMultiSelect && (
                    <span
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] ${
                        selectedLabels.has(opt.label) ? 'bg-accent text-accent-fg' : 'border-[1.5px] border-board'
                      }`}
                    >
                      {selectedLabels.has(opt.label) && <Check size={12} strokeWidth={3} aria-hidden />}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-14 font-medium text-primary">{opt.label}</span>
                    {opt.description && (
                      <span className="mt-0.5 block text-13 text-secondary">{opt.description}</span>
                    )}
                  </span>
                </div>
                <span className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-perm-code-bg font-mono text-13 text-secondary">
                  {idx + 1}
                </span>
              </button>
            </div>
          ))}

          {/* 自由输入行（宿主统一提供，取代模型自造的「其他」选项） */}
          <div className="h-px bg-board" />
          {showCustomInput ? (
            <div className="flex items-start gap-2 px-3.5 py-2.5">
              {isMultiSelect && (
                <span
                  className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] ${
                    customInput.trim() ? 'bg-accent text-accent-fg' : 'border-[1.5px] border-board'
                  }`}
                >
                  {customInput.trim() && <Check size={12} strokeWidth={3} aria-hidden />}
                </span>
              )}
              <textarea
                ref={inputRef}
                rows={1}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (isMultiSelect) handleMultiNext();
                    else handleCustomSubmit();
                  }
                }}
                placeholder="输入你的回答…"
                className="max-h-[148px] min-h-[22px] min-w-0 flex-1 resize-none bg-transparent text-14 leading-relaxed text-primary outline-none select-text placeholder:text-muted"
              />
              {!isMultiSelect && (
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customInput.trim()}
                  className={`shrink-0 self-end rounded-inner px-3 py-[7px] text-13 font-medium transition-colors ${
                    customInput.trim() ? 'bg-accent text-accent-fg hover:opacity-90' : 'border border-board text-muted'
                  }`}
                >
                  {isLast ? '提交' : '下一题'}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
              onClick={openCustomInput}
            >
              <span className="text-14 italic text-secondary">输入其它回答…</span>
              <span className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-perm-code-bg font-mono text-13 text-secondary">
                {options.length + 1}
              </span>
            </button>
          )}
        </div>
      )}

      {/* 无选项题：纯自由输入 */}
      {options.length === 0 && (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={customInput}
            autoFocus
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (customInput.trim()) advance(customInput.trim());
              }
            }}
            placeholder="输入你的回答…"
            className="max-h-[148px] min-h-10 min-w-0 flex-1 resize-none rounded-inner border border-board bg-transparent px-3 py-2 text-14 leading-relaxed text-primary outline-none select-text placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => customInput.trim() && advance(customInput.trim())}
            disabled={!customInput.trim()}
            className={`h-10 shrink-0 rounded-inner px-4 text-13 font-medium transition-colors ${
              customInput.trim() ? 'bg-accent text-accent-fg hover:opacity-90' : 'border border-board text-muted'
            }`}
          >
            {isLast ? '提交' : '下一题'}
          </button>
        </div>
      )}

      {/* 操作行 */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={handleBack}
            className="rounded-inner border border-board bg-transparent px-3 py-[7px] text-13 font-medium text-primary transition-colors hover:bg-perm-code-bg"
          >
            上一题
          </button>
        )}
        <button
          type="button"
          onClick={() => advance('')}
          className="flex items-center gap-2 rounded-inner border border-board bg-transparent px-3 py-[7px] text-13 font-medium text-primary transition-colors hover:bg-perm-code-bg"
        >
          <span>跳过</span>
          <kbd className="rounded-[4px] border border-board bg-perm-code-bg px-1.5 py-[1px] font-mono text-11 font-normal text-secondary">
            Esc
          </kbd>
        </button>
        {showNext && (
          <button
            type="button"
            onClick={() => (isMultiSelect ? handleMultiNext() : advance(existingAnswer ?? ''))}
            disabled={nextDisabled}
            className={`rounded-inner px-3 py-[7px] text-13 font-medium transition-colors ${
              nextDisabled
                ? 'cursor-not-allowed border border-board text-muted opacity-50'
                : 'bg-accent text-accent-fg hover:opacity-90'
            }`}
          >
            {isLast ? '提交' : '下一题'}
          </button>
        )}
      </div>
    </div>
  );
}
