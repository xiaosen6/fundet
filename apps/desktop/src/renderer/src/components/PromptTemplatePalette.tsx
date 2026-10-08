/**
 * 提示词模板浮层（composer 工具行入口）：懒加载模板列表，点选经
 * shared/prompt-templates.ts 的 DOM 事件协议插入输入框光标处。
 */
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import type { PromptTemplateView } from '../../../shared/prompt-templates.ts';

interface PromptTemplatePaletteProps {
  onClose: () => void;
  onPick: (t: PromptTemplateView) => void;
}

export function PromptTemplatePalette({ onClose, onPick }: PromptTemplatePaletteProps): React.JSX.Element {
  const [items, setItems] = useState<PromptTemplateView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    window.fundet
      .listPromptTemplates()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[240px] overflow-y-auto rounded-container border border-board bg-card py-1">
      {error ? (
        <p className="px-3 py-2 text-12 text-error">{error}</p>
      ) : items === null ? (
        <p className="px-3 py-2 text-12 text-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-2 text-12 text-muted">
          还没有模板。到 设置 → 提示词模板 添加常用指令，之后在这里一键插入。
        </p>
      ) : (
        items.map((t) => (
          <button
            key={t.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(t);
            }}
            className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-hover-soft')}
          >
            <span className="mt-px shrink-0 text-11 text-muted">⚡</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-13 font-medium text-primary">{t.title}</span>
              <span className="block truncate text-11 text-muted">{t.content.split('\n')[0]}</span>
            </span>
          </button>
        ))
      )}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        className="w-full px-3 py-1 text-left text-11 text-muted hover:bg-hover-soft"
      >
        关闭（Esc）
      </button>
    </div>
  );
}
