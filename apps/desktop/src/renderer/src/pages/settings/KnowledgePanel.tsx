/**
 * KnowledgePanel —— 设置 → 知识库。
 *
 * 纯本地 FTS5 关键词检索：新建/删除知识库、导入 PDF/DOCX/TXT/MD、
 * 管理已导入文档、召回测试。会话在对话页绑定知识库后，
 * 助手获得 knowledge_search 工具（带来源编号的原文片段）。
 */
import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, Trash2 } from 'lucide-react';
import type {
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeSearchResult,
} from '../../../../shared/fundet-api.js';

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

const inputCls =
  'h-9 w-full rounded-lg border border-board bg-card px-3 text-13 text-primary placeholder:text-muted focus:border-accent focus:outline-none';

export function KnowledgePanel(): React.JSX.Element {
  const [kbs, setKbs] = useState<KnowledgeBaseView[]>([]);
  const [newName, setNewName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocView[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setKbs(await window.fundet.listKnowledgeBases());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadDocs = useCallback(async (kbId: string): Promise<void> => {
    setDocs(await window.fundet.listKnowledgeDocs(kbId));
  }, []);

  const create = async (): Promise<void> => {
    setError('');
    if (!newName.trim()) {
      setError('请输入知识库名称');
      return;
    }
    setBusy(true);
    try {
      const kb = await window.fundet.createKnowledgeBase(newName.trim());
      setNewName('');
      await refresh();
      setExpandedId(kb.id);
      setDocs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (kb: KnowledgeBaseView): void => {
    if (!window.confirm(`删除知识库「${kb.name}」？其中 ${kb.docCount} 份文档的索引将一并删除。`)) return;
    void window.fundet.deleteKnowledgeBase(kb.id).then(refresh).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const expand = async (kb: KnowledgeBaseView): Promise<void> => {
    setError('');
    if (expandedId === kb.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(kb.id);
    setResults(null);
    setQuery('');
    await loadDocs(kb.id);
  };

  const importFiles = async (kb: KnowledgeBaseView): Promise<void> => {
    setError('');
    const paths = await window.fundet.pickKnowledgeFiles();
    if (paths.length === 0) return;
    setBusy(true);
    try {
      const results = await window.fundet.importKnowledgeFiles(kb.id, paths);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(failed.map((f) => `${f.name}：${f.error ?? '失败'}`).join('；'));
      }
      await loadDocs(kb.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (doc: KnowledgeDocView): Promise<void> => {
    setError('');
    try {
      await window.fundet.removeKnowledgeDoc(doc.id);
      await loadDocs(doc.kbId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runRecall = async (kb: KnowledgeBaseView): Promise<void> => {
    setError('');
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await window.fundet.searchKnowledge([kb.id], query.trim(), 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <SectionTitle>知识库</SectionTitle>
        <p className="mt-1 text-13 text-secondary">
          导入自己的文档（PDF / DOCX / TXT / MD），在对话页把知识库绑定到会话，
          助手即可检索原文片段并标注来源。检索在本机全文匹配，不上传任何内容。
        </p>
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={newName}
          placeholder="新建知识库名称，如：产品手册"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="h-9 shrink-0 rounded-lg bg-accent px-4 text-13 font-medium text-accent-fg disabled:opacity-50"
        >
          新建
        </button>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}

      {kbs.length === 0 ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有知识库。新建一个并导入文档后，到对话页绑定即可使用。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {kbs.map((kb) => (
            <div key={kb.id} className="rounded-xl border border-board bg-card-ivory px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void expand(kb)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="truncate text-14 font-medium text-primary">{kb.name}</span>
                  <span className="ml-2 text-12 text-muted">
                    {kb.docCount} 份文档 · {kb.chunkCount} 个片段
                  </span>
                </button>
                <button
                  type="button"
                  title="删除知识库"
                  onClick={() => remove(kb)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-error"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {expandedId === kb.id && (
                <div className="mt-3 flex flex-col gap-3 border-t border-board pt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void importFiles(kb)}
                      className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary disabled:opacity-50"
                    >
                      <FilePlus2 size={13} />
                      导入文档
                    </button>
                    <span className="text-11 text-muted">支持 PDF / DOCX / TXT / MD，可多选</span>
                  </div>

                  {docs.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {docs.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 rounded-lg bg-chip px-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-12 text-primary">{d.name}</span>
                          <span className="shrink-0 text-11 text-muted">
                            {d.chunkCount} 片段 · {Math.max(1, Math.round(d.chars / 1000))}k 字
                          </span>
                          <button
                            type="button"
                            title="移除文档"
                            onClick={() => void removeDoc(d)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-error"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <span className="text-12 text-secondary">召回测试：输入一个用户可能会问的问题</span>
                    <div className="flex gap-2">
                      <input
                        className={inputCls}
                        value={query}
                        placeholder="如：退货流程是什么"
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runRecall(kb);
                        }}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runRecall(kb)}
                        className="h-9 shrink-0 rounded-lg border border-board px-4 text-13 text-secondary hover:text-primary disabled:opacity-50"
                      >
                        测试
                      </button>
                    </div>
                    {results !== null && (
                      <div className="flex flex-col gap-1.5">
                        {results.length === 0 ? (
                          <p className="text-12 text-muted">没有命中。换个和文档原文接近的词试试。</p>
                        ) : (
                          results.map((r, i) => (
                            <div key={i} className="rounded-lg bg-chip px-3 py-2">
                              <p className="text-11 text-muted">
                                【{i + 1}】{r.docName}（第 {r.ord} 块）
                              </p>
                              <p className="mt-0.5 text-12 leading-[1.6] text-primary select-text">{r.snippet}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
