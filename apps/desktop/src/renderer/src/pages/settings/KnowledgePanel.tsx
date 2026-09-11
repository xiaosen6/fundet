/**
 * KnowledgePanel —— 设置 → 知识库。
 *
 * 纯本地 FTS5 关键词检索：新建/删除知识库、导入文件或整个文件夹（PDF/DOCX/TXT/MD）、
 * 管理已导入文档、KB 级检索/分块参数、召回测试、失败项重试。
 * 会话在对话页绑定知识库后，助手获得 knowledge_search 工具（带来源编号的原文片段）。
 */
import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderPlus, Globe, NotebookPen, Pencil, RotateCw, Trash2 } from 'lucide-react';
import type {
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeImportResult,
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
  const [importResults, setImportResults] = useState<KnowledgeImportResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ id: string | null; title: string; content: string } | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState('');

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
      setImportResults(null);
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
    setImportResults(null);
    await loadDocs(kb.id);
  };

  const runImport = async (kbId: string, run: () => Promise<KnowledgeImportResult[]>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const imported = await run();
      setImportResults(imported);
      await loadDocs(kbId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const failedPaths = (importResults ?? []).filter((r) => !r.ok && r.path).map((r) => r.path!);

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

  const saveNote = async (kb: KnowledgeBaseView): Promise<void> => {
    if (!noteDraft) return;
    setError('');
    setBusy(true);
    try {
      await window.fundet.saveKnowledgeNote(kb.id, noteDraft.id, noteDraft.title, noteDraft.content);
      setNoteDraft(null);
      await loadDocs(kb.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const editNote = async (kb: KnowledgeBaseView, doc: KnowledgeDocView): Promise<void> => {
    setError('');
    try {
      const content = (await window.fundet.getKnowledgeNoteContent(doc.id)) ?? '';
      setNoteDraft({ id: doc.id, title: doc.name.replace(/^笔记：/, ''), content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runSnapshot = async (kb: KnowledgeBaseView): Promise<void> => {
    setError('');
    if (!snapshotUrl.trim()) return;
    setBusy(true);
    try {
      await window.fundet.snapshotKnowledgeUrl(kb.id, snapshotUrl.trim());
      setSnapshotUrl('');
      await loadDocs(kb.id);
      await refresh();
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
          新建知识库，添加一个文件夹或几个文档即可。之后在对话页点「知识库」绑定，
          助手回答时就会查这些资料并标明出处。全程在本机完成，不上传任何内容。
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
                <button type="button" onClick={() => void expand(kb)} className="min-w-0 flex-1 text-left">
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
                  {/* 导入 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runImport(kb.id, () => window.fundet.pickKnowledgeFiles().then((paths) => (paths.length > 0 ? window.fundet.importKnowledgeFiles(kb.id, paths) : [])))}
                      className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary disabled:opacity-50"
                    >
                      <FilePlus2 size={13} />
                      导入文档
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runImport(kb.id, () => window.fundet.pickDirectory().then((dir) => (dir ? window.fundet.importKnowledgeDir(kb.id, dir) : [])))}
                      className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary disabled:opacity-50"
                    >
                      <FolderPlus size={13} />
                      导入文件夹
                    </button>
                    <span className="text-11 text-muted">支持 PDF / DOCX / TXT / MD</span>
                  </div>

                  {/* 笔记：新建/编辑 */}
                  {noteDraft ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-chip px-3 py-2">
                      <input
                        className={inputCls}
                        value={noteDraft.title}
                        placeholder="笔记标题"
                        onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })}
                      />
                      <textarea
                        className={`${inputCls} h-32 py-2 leading-[1.6]`}
                        value={noteDraft.content}
                        placeholder="笔记内容（保存后可被检索）"
                        onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveNote(kb)}
                          className="h-7 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-50"
                        >
                          保存笔记
                        </button>
                        <button
                          type="button"
                          onClick={() => setNoteDraft(null)}
                          className="h-7 rounded-full border border-board px-3 text-12 text-secondary"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setNoteDraft({ id: null, title: '', content: '' });
                        }}
                        className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary"
                      >
                        <NotebookPen size={13} />
                        新建笔记
                      </button>
                      <span className="text-11 text-muted">笔记可随时再编辑，改动会重建索引</span>
                    </div>
                  )}

                  {/* URL 快照 */}
                  <div className="flex items-center gap-2">
                    <Globe size={13} className="shrink-0 text-muted" />
                    <input
                      className={`${inputCls} h-8`}
                      value={snapshotUrl}
                      placeholder="https://…（抓取网页正文入库，仅公网地址）"
                      onChange={(e) => setSnapshotUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runSnapshot(kb);
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !snapshotUrl.trim()}
                      onClick={() => void runSnapshot(kb)}
                      className="h-8 shrink-0 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary disabled:opacity-50"
                    >
                      抓取
                    </button>
                  </div>

                  {/* 导入结果（逐文件 + 失败重试） */}
                  {importResults !== null && importResults.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {importResults.map((r, i) => (
                        <div key={`${r.path ?? r.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-chip px-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-12 text-primary">{r.name}</span>
                          {r.ok ? (
                            <span className="shrink-0 text-11 text-success">{r.chunks} 片段</span>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-right text-11 text-error" title={r.error}>
                              失败：{r.error}
                            </span>
                          )}
                        </div>
                      ))}
                      {failedPaths.length > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runImport(kb.id, () => window.fundet.importKnowledgeFiles(kb.id, failedPaths))}
                          className="flex h-8 w-fit items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary hover:text-primary disabled:opacity-50"
                        >
                          <RotateCw size={12} />
                          重试失败项（{failedPaths.length}）
                        </button>
                      )}
                    </div>
                  )}

                  {/* 文档列表 */}
                  {docs.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {docs.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 rounded-lg bg-chip px-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-12 text-primary">{d.name}</span>
                          <span className="shrink-0 text-11 text-muted">
                            {d.chunkCount} 片段 · {Math.max(1, Math.round(d.chars / 1000))}k 字
                          </span>
                          {d.kind === 'note' && (
                            <button
                              type="button"
                              title="编辑笔记"
                              onClick={() => void editNote(kb, d)}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-primary"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
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

                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
