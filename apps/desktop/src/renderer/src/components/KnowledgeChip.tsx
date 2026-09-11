/**
 * KnowledgeChip — composer 工具行的会话知识库绑定 chip。
 *
 * 勾选库后新消息注入 knowledge MCP，助手按需调 knowledge_search 检索。
 * 绑定按会话存 SQLite。自动注入开关已按用户反馈移除（绑定结构保留 auto
 * 字段，默认 false，后端能力不删）。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Library, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { MorphPopover } from './ui/MorphPopover';
import type { KnowledgeBaseView, KnowledgeSessionBinding } from '../../../shared/fundet-api.ts';

const IDLE: KnowledgeSessionBinding = { ids: [], auto: false };

export function KnowledgeChip({ sessionId }: { sessionId: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [kbs, setKbs] = useState<KnowledgeBaseView[]>([]);
  const [binding, setBinding] = useState<KnowledgeSessionBinding>(IDLE);

  useEffect(() => {
    if (!sessionId) {
      setBinding(IDLE);
      return;
    }
    void window.fundet.getSessionKnowledgeBinding(sessionId).then(setBinding).catch(() => undefined);
  }, [sessionId]);

  const persist = (next: KnowledgeSessionBinding): void => {
    if (!sessionId) return;
    setBinding(next);
    void window.fundet.setSessionKnowledgeBinding(sessionId, next).catch(() => undefined);
  };

  const toggleKb = (id: string): void => {
    const ids = binding.ids.includes(id)
      ? binding.ids.filter((x) => x !== id)
      : [...binding.ids, id];
    persist({ ...binding, ids });
  };

  const trigger = (
    <button
      type="button"
      title="绑定知识库"
      onClick={() => {
        setOpen(!open);
        void window.fundet.listKnowledgeBases().then(setKbs).catch(() => undefined);
      }}
      className={cn(
        'inline-flex h-[30px] items-center gap-2 rounded-full border border-transparent bg-transparent px-2.5 text-13 text-primary transition-colors select-none hover:border-board hover:bg-composer-pill',
        (binding.ids.length > 0 || binding.auto) && 'border-board bg-composer-pill',
      )}
    >
      <Library size={14} className="shrink-0" />
      <span>知识库{binding.ids.length > 0 ? ` · ${binding.ids.length}` : ''}</span>
      <ChevronDown size={14} className="shrink-0 text-muted" />
    </button>
  );

  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      panelWidth={320}
      panelClassName="p-2"
      panelAriaLabel="绑定知识库"
      wrapperClassName="shrink-0"
      trigger={trigger}
    >
      <div className="flex flex-col">
        {kbs.length === 0 ? (
          <div className="px-3 py-2 text-12 leading-relaxed text-muted">
            还没有知识库。可先在
            <Link
              to="/settings"
              state={{ tab: 'knowledge' }}
              className="mx-1 text-accent hover:underline"
              onClick={() => setOpen(false)}
            >
              设置 → 知识库
            </Link>
            创建并导入文档。
          </div>
        ) : (
          <>
            {kbs.map((kb) => {
              const on = binding.ids.includes(kb.id);
              return (
                <button
                  key={kb.id}
                  type="button"
                  onClick={() => toggleKb(kb.id)}
                  className="flex w-full items-center gap-3 rounded-inner px-3 py-2 text-left hover:bg-menu-item-hover"
                >
                  <Library size={16} className={cn('shrink-0', on ? 'text-accent' : 'text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-14 text-primary">{kb.name}</span>
                    <span className="block text-11 text-muted">{kb.docCount} 份文档</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none',
                      on ? 'border-accent bg-accent text-accent-fg' : 'border-board',
                    )}
                  >
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </MorphPopover>
  );
}
