/**
 * PermissionPrompt —— 权限审批卡（复刻 Cindy new-chat/PermissionPrompt.tsx），
 * 悬挂时替换 composer 区域。
 *
 * 布局：标题（text-15 font-semibold）→ 描述 → 代码块（工具入参，rounded-8，
 * --perm-code-bg）→ 右对齐操作按钮（inline 文案 + kbd 快捷键徽章）。
 * 「允许一次」是白底黑字的主按钮（--card 底 + Board 描边）；其余为透明底描边按钮。
 *
 * 快捷键（挂载期间全局监听，让位判据见 lib/card-shortcut-yield.ts，Cindy #5256）：
 *   Enter       → 允许一次（焦点在卡片按钮上时让给按钮原生激活——「拒绝」上回车=拒绝）
 *   Ctrl+Enter  → 本会话总允许（pi decision 只认 allow/deny，会话级规则由
 *                 renderer 侧自动放行实现，见 sessionStore.resolvePermission）
 *   Esc         → 拒绝（卡片外浮层/输入框上的 Esc 不劫持）
 */
import { useCallback, useEffect, useRef } from 'react';
import type { InteractionRequest } from '@fundet/agent-core';
import { formatToolInput } from '../lib/toolText';
import { shouldCardShortcutYield } from '../lib/card-shortcut-yield';

interface PermissionPromptProps {
  request: Extract<InteractionRequest, { kind: 'permission' }>;
  onRespond: (behavior: 'allow' | 'deny' | 'allow-session') => void;
}

/** kbd 徽章（描边小方块，对齐 Cindy 的 px-1.5 py-[1px] text-11） */
function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded-[4px] border border-board bg-perm-code-bg px-1.5 py-[1px] font-mono text-11 font-normal text-secondary">
      {children}
    </kbd>
  );
}

export function PermissionPrompt({ request, onRespond }: PermissionPromptProps): React.JSX.Element {
  const handleAllowOnce = useCallback(() => onRespond('allow'), [onRespond]);
  const handleAllowSession = useCallback(() => onRespond('allow-session'), [onRespond]);
  const handleDeny = useCallback(() => onRespond('deny'), [onRespond]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (shouldCardShortcutYield(e, 'modifiedActivate', rootRef.current)) return;
        e.preventDefault();
        handleAllowSession();
      } else if (e.key === 'Enter') {
        // 焦点在卡片按钮（如「拒绝」）上时让位给按钮原生激活，不替用户改主意
        if (shouldCardShortcutYield(e, 'activate', rootRef.current)) return;
        e.preventDefault();
        handleAllowOnce();
      } else if (e.key === 'Escape') {
        if (shouldCardShortcutYield(e, 'dismiss', rootRef.current)) return;
        e.preventDefault();
        handleDeny();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleAllowOnce, handleAllowSession, handleDeny]);

  const codeContent = formatToolInput(request.toolName, request.input);

  return (
    <div ref={rootRef} className="w-full rounded-container border border-board bg-card p-4">
      {/* 标题 */}
      <p className="text-15 leading-tight font-semibold text-primary">
        允许执行 <span className="font-mono">{request.displayName ?? request.toolName}</span>？
      </p>

      {/* 描述 */}
      {request.description && (
        <p className="mt-1.5 text-13 leading-tight text-secondary">{request.description}</p>
      )}

      {/* 代码块（工具入参） */}
      <div className="mt-3 max-h-[120px] overflow-auto rounded-inner border border-board bg-perm-code-bg px-3.5 py-2.5">
        <pre className="font-mono text-13 leading-relaxed break-all whitespace-pre-wrap text-primary select-text">
          {codeContent}
        </pre>
      </div>

      {/* 操作按钮：inline 文案 + kbd 徽章，右对齐 */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDeny}
          className="flex items-center gap-2 rounded-inner border border-board bg-transparent px-3 py-[7px] text-13 font-medium text-primary transition-colors hover:bg-perm-code-bg"
        >
          <span>拒绝</span>
          <Kbd>Esc</Kbd>
        </button>
        <button
          type="button"
          onClick={handleAllowSession}
          className="flex items-center gap-2 rounded-inner border border-board bg-transparent px-3 py-[7px] text-13 font-medium text-primary transition-colors hover:bg-perm-code-bg"
        >
          <span>本会话总允许</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
        </button>
        {/* 允许一次（主按钮：反相 CTA 底） */}
        <button
          type="button"
          onClick={handleAllowOnce}
          className="flex items-center gap-2 rounded-inner border border-board bg-accent px-3 py-[7px] text-13 font-medium text-accent-fg transition-colors hover:opacity-90"
        >
          <span>允许一次</span>
          <kbd className="rounded-[4px] border border-[var(--accent-kbd-border)] bg-[var(--accent-kbd-bg)] px-1.5 py-[1px] font-mono text-11 font-normal text-accent-fg opacity-80">
            Enter
          </kbd>
        </button>
      </div>
    </div>
  );
}
