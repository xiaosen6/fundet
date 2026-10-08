/**
 * PromptTemplatesPanel —— 设置 → 提示词模板。
 *
 * 常用提示词管理面：新建/编辑（弹层）/删除（确认），落 main 进程 prompt_templates 表。
 * composer 侧经 window.fundet.listPromptTemplates 取列表做一键插入（DOM 事件协议
 * 见 shared/prompt-templates.ts），本面板只管数据面。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { PromptTemplateView } from '../../../../shared/fundet-api.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog';

interface DraftState {
  id: string | null;
  title: string;
  content: string;
}

const EMPTY_DRAFT: DraftState = { id: null, title: '', content: '' };

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

/** 内容摘要：首行截断 + 行数徽标（空行不计数） */
function summarize(content: string): { firstLine: string; lines: number } {
  const lines = content.split('\n').filter((l) => l.trim()).length;
  const firstLine = content.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return { firstLine, lines };
}

export function PromptTemplatesPanel(): React.JSX.Element {
  const [list, setList] = useState<PromptTemplateView[] | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setList(await window.fundet.listPromptTemplates());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    setError('');
    if (!draft.title.trim()) {
      setError('模板标题不能为空');
      return;
    }
    if (!draft.content.trim()) {
      setError('模板内容不能为空');
      return;
    }
    setSaving(true);
    try {
      await window.fundet.savePromptTemplate({
        id: draft.id,
        title: draft.title,
        content: draft.content,
      });
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = (t: PromptTemplateView): void => {
    void (async (): Promise<void> => {
      const ok = await confirmDialog({
        title: `删除模板「${t.title}」？`,
        description: '删除后不可恢复；已发出的消息不受影响。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.fundet.deletePromptTemplate(t.id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>提示词模板</SectionTitle>
          <p className="mt-1 text-13 text-secondary">
            保存常用提示词，在输入框一键插入，不用每次重打长指令。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError('');
            setDraft({ ...EMPTY_DRAFT });
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
        >
          <Plus size={13} />
          新建模板
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-board bg-card px-4 py-2.5 text-12 text-error">{error}</div>
      )}

      {/* 编辑弹层（对齐 AutomationsPanel 创建自动化） */}
      {draft && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-neutral-900/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <div className="flex max-h-[82vh] w-full max-w-[560px] flex-col rounded-2xl border border-board bg-card shadow-[var(--shadow-menu)]">
            <div className="flex items-start justify-between px-5 pt-5 pb-3">
              <div>
                <p className="text-18 font-medium text-primary">{draft.id ? '编辑模板' : '新建模板'}</p>
                <p className="mt-1 text-12 text-muted">保存后在输入框的模板入口一键插入。</p>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-primary"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-12 text-muted">标题</span>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="如：周报汇总"
                  className="h-10 rounded-xl border border-board bg-card px-3.5 text-14 text-primary outline-none placeholder:text-placeholder focus:border-[var(--input-focus-border)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-12 text-muted">内容</span>
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={8}
                  placeholder={'示例：汇总本周的工作进展，按「完成 / 进行中 / 风险」三段输出。'}
                  className="rounded-xl border border-board bg-card px-3.5 py-2.5 font-mono text-13 leading-relaxed text-primary outline-none placeholder:text-placeholder focus:border-[var(--input-focus-border)]"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-board/40 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-9 rounded-full border border-board px-4 text-13 text-secondary hover:text-primary"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving || !draft.title.trim() || !draft.content.trim()}
                onClick={() => void save()}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-13 font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {draft.id ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 列表 / 空态 */}
      {list === null ? (
        <div className="flex h-32 items-center justify-center gap-2 text-13 text-muted">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 select-none">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-chip text-muted">
            <Plus size={22} />
          </span>
          <p className="text-16 font-medium text-primary">暂无模板</p>
          <p className="max-w-[420px] text-center text-12 leading-relaxed text-muted">
            把常用的长提示词存成模板，写消息时一键插入输入框。
          </p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setDraft({ ...EMPTY_DRAFT });
            }}
            className="mt-2 flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-13 font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Plus size={14} /> 新建模板
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((t) => {
            const { firstLine, lines } = summarize(t.content);
            return (
              <div
                key={t.id}
                className="flex items-start gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-14 font-medium text-primary">{t.title}</span>
                    {lines > 1 && (
                      <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-11 text-muted">
                        {lines} 行
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-12 text-muted" title={t.content}>
                    {firstLine || '（空）'}
                  </p>
                </div>
                <button
                  type="button"
                  title="编辑"
                  onClick={() => {
                    setError('');
                    setDraft({ id: t.id, title: t.title, content: t.content });
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-primary"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => remove(t)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-error"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
