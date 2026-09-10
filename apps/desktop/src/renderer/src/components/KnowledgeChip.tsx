/**
 * KnowledgeChip — composer 工具行的会话知识库绑定 chip。
 *
 * 勾选后（新消息起）该会话注入 knowledge MCP：助手获得 knowledge_search
 * 工具，检索返回带来源编号的原文片段。绑定按会话存 SQLite。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Library, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { MorphPopover } from './ui/MorphPopover';
import type { KnowledgeBaseView } from '../../../shared/fundet-api.ts';

export function KnowledgeChip({ sessionId }: { sessionId: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [kbs, setKbs] = useState<KnowledgeBaseView[]>([]);
  const [bound, setBound] = useState<string[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setBound([]);
      return;
    }
    void window.fundet.getSessionKnowledgeKbs(sessionId).then(setBound).catch(() => undefined);
  }, [sessionId]);

  const toggle = (id: string): void => {
    if (!sessionId) return;
    const next = bound.includes(id) ? bound.filter((x) => x !== id) : [...bound, id];
    setBound(next);
    void window.fundet.setSessionKnowledgeKbs(sessionId, next).catch(() => undefined);
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
        bound.length > 0 && 'border-board bg-composer-pill',
      )}
    >
      <Library size={14} className="shrink-0" />
      <span>知识库{bound.length > 0 ? ` · ${bound.length}` : ''}</span>
      <ChevronDown size={14} className="shrink-0 text-muted" />
    </button>
  );

  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      panelWidth={300}
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
              const on = bound.includes(kb.id);
              return (
                <button
                  key={kb.id}
                  type="button"
                  onClick={() => toggle(kb.id)}
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
            <div className="mx-2 my-1 h-px bg-board" />
            <div className="px-3 py-2 text-11 leading-snug text-muted">
              勾选后助手可在新消息里检索这些文档（knowledge_search，带来源标注）。
              <Link
                to="/settings"
                state={{ tab: 'knowledge' }}
                className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline"
                onClick={() => setOpen(false)}
              >
                <Settings2 size={11} />
                管理
              </Link>
            </div>
          </>
        )}
      </div>
    </MorphPopover>
  );
}
