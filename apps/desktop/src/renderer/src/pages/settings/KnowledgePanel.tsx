/**
 * KnowledgePanel —— 知识库（卡片形态）。
 *
 * 纯本地 FTS5 关键词检索：新建/删除知识库、导入文件或整个文件夹（PDF/DOCX/TXT/MD）、
 * 管理已导入文档、笔记、网页快照、导入进度与失败重试。
 * 卡片语言与钉钉组件板同款：icon chip 头部 + hero 大数字 + 发丝行 + Reveal 展开
 * + 交错入场（rise-in）+ 系统 border-only hover。会话绑定后助手获得
 * knowledge_search 工具（带来源编号的原文片段）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  FilePlus2,
  FileText,
  FolderPlus,
  Globe,
  NotebookPen,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type {
  KbImportProgress,
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeImportResult,
} from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../components/ui/ConfirmDialog';
import { toast } from '../../components/ui/toast';

const inputCls =
  'h-9 w-full rounded-lg border border-board bg-card px-3 text-13 text-primary placeholder:text-muted focus:border-accent focus:outline-none';

const ACTION_PILL =
  'flex h-8 items-center gap-1.5 rounded-full border border-board px-3 text-12 text-secondary transition-colors hover:border-[var(--input-focus-border)] hover:text-primary disabled:opacity-50';

function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 3600_000) return '刚刚';
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 30 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}

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
  const [importProgress, setImportProgress] = useState<KbImportProgress | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setKbs(await window.fundet.listKnowledgeBases());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 大目录导入时主进程逐文件推送进度；runImport 结束统一清空
  useEffect(() => window.fundet.onKbImportProgress(setImportProgress), []);

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
    void (async (): Promise<void> => {
      const ok = await confirmDialog({
        title: `删除知识库「${kb.name}」？`,
        description: `其中 ${kb.docCount} 份文档的索引将一并删除，此操作不可撤销。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.fundet.deleteKnowledgeBase(kb.id);
        if (expandedId === kb.id) setExpandedId(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
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
    setImportProgress(null);
    try {
      const imported = await run();
      setImportResults(imported);
      const okCount = imported.filter((r) => r.ok).length;
      if (imported.length > 0) {
        if (okCount === imported.length) toast.success(`已导入 ${okCount} 份文档`);
        else toast.error(`${okCount}/${imported.length} 份导入成功，失败项可在下方重试`);
      }
      await loadDocs(kbId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  };

  const failedPaths = (importResults ?? []).filter((r) => !r.ok && r.path).map((r) => r.path!);

  const removeDoc = (doc: KnowledgeDocView): void => {
    void (async (): Promise<void> => {
      const ok = await confirmDialog({
        title: `移除文档「${doc.name}」？`,
        description: '其索引片段将一并删除，需要时可重新导入。',
        confirmText: '移除',
        danger: true,
      });
      if (!ok) return;
      setError('');
      try {
        await window.fundet.removeKnowledgeDoc(doc.id);
        await loadDocs(doc.kbId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const saveNote = async (kb: KnowledgeBaseView): Promise<void> => {
    if (!noteDraft) return;
    setError('');
    setBusy(true);
    try {
      await window.fundet.saveKnowledgeNote(kb.id, noteDraft.id, noteDraft.title, noteDraft.content);
      setNoteDraft(null);
      toast.success('笔记已保存');
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
      const doc = await window.fundet.snapshotKnowledgeUrl(kb.id, snapshotUrl.trim());
      setSnapshotUrl('');
      toast.success(doc ? `已入库：${doc.name}` : '网页已入库');
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
        <h2 className="text-16 leading-[1.2] font-medium text-primary">知识库</h2>
        <p className="mt-1 text-13 text-secondary">
          新建知识库，添加一个文件夹或几个文档即可。之后在对话页点「知识库」绑定，
          助手回答时就会查这些资料并标明出处。全程在本机完成，不上传任何内容。
        </p>
      </div>
      <div className="flex gap-2">
        <input
          ref={nameInputRef}
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
          className="h-9 shrink-0 rounded-full bg-accent px-4 text-13 font-medium text-accent-fg disabled:opacity-50"
        >
          新建
        </button>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}

      {kbs.length === 0 ? (
        <div className="flex min-h-[140px] flex-1 items-center gap-2.5 rounded-container border border-board bg-card p-5 text-12 text-muted">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chip">
            <BookOpen size={13} strokeWidth={1.8} />
          </span>
          还没有知识库。新建一个并导入文档后，到对话页绑定即可使用。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {kbs.map((kb, idx) => {
            const open = expandedId === kb.id;
            return (
              <div
                key={kb.id}
                className={cn(
                  'group animate-fundet-rise-in fundet-surface flex min-w-0 flex-col rounded-container border border-board bg-card px-5 py-4 select-none',
                  open ? 'border-[var(--input-focus-border)]' : 'hover:border-[var(--input-focus-border)]',
                )}
                style={{ animationDelay: `${Math.min(idx, 6) * 60}ms` }}
              >
                {/* 卡头 + hero（点击展开；删除钮独立悬浮右侧） */}
                <div className="flex items-start gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void expand(kb)} aria-expanded={open}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
                        <BookOpen size={13} strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-13 font-medium text-primary" title={kb.name}>
                        {kb.name}
                      </span>
                      {kb.docCount === 0 && (
                        <span className="rounded-full bg-hover-soft px-1.5 py-px text-11 text-muted">空库</span>
                      )}
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="text-3xl font-medium leading-none tabular-nums text-primary">{kb.docCount}</span>
                      <span className="text-12 leading-none text-muted">份文档</span>
                    </div>
                    <p className="mt-1.5 text-11 text-muted">
                      {kb.chunkCount.toLocaleString()} 个片段
                      {kb.createdAt > 0 ? ` · 建于 ${fmtAgo(kb.createdAt)}` : ''}
                      {open ? ' · 点击收起' : ' · 点击管理'}
                    </p>
                  </button>
                  <button
                    type="button"
                    title="删除知识库"
                    onClick={() => remove(kb)}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition-all duration-[var(--motion-fast)] hover:text-error group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* 展开：导入 / 笔记 / 快照 / 进度 / 文档 */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-[var(--motion-base)] ease-[var(--motion-ease-move)]',
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-3 flex flex-col gap-3 border-t border-board/40 pt-3">
                      {/* 导入 */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runImport(kb.id, () => window.fundet.pickKnowledgeFiles().then((paths) => (paths.length > 0 ? window.fundet.importKnowledgeFiles(kb.id, paths) : [])))}
                          className={ACTION_PILL}
                        >
                          <FilePlus2 size={13} />
                          导入文档
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runImport(kb.id, () => window.fundet.pickDirectory().then((dir) => (dir ? window.fundet.importKnowledgeDir(kb.id, dir) : [])))}
                          className={ACTION_PILL}
                        >
                          <FolderPlus size={13} />
                          导入文件夹
                        </button>
                        <span className="text-11 text-muted/70">PDF / DOCX / TXT / MD</span>
                      </div>

                      {/* 导入进度（多文件/目录导入时主进程逐文件推送） */}
                      {busy && importProgress && importProgress.kbId === kb.id && importProgress.total > 1 && (
                        <div className="flex flex-col gap-1">
                          <div className="h-1 overflow-hidden rounded-full bg-chip">
                            <div
                              className="h-full bg-accent transition-[width] duration-[var(--motion-fast)]"
                              style={{ width: `${Math.round((importProgress.completed / importProgress.total) * 100)}%` }}
                            />
                          </div>
                          <span className="truncate text-11 text-muted">
                            导入中 {Math.min(importProgress.completed + 1, importProgress.total)}/{importProgress.total}：{importProgress.current}
                          </span>
                        </div>
                      )}

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
                            className={ACTION_PILL}
                          >
                            <NotebookPen size={13} />
                            新建笔记
                          </button>
                          <span className="text-11 text-muted/70">笔记可随时再编辑，改动会重建索引</span>
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
                              className={ACTION_PILL}
                            >
                              <RotateCw size={12} />
                              重试失败项（{failedPaths.length}）
                            </button>
                          )}
                        </div>
                      )}

                      {/* 文档列表（发丝行 + 悬停浮现操作） */}
                      {docs.length > 0 && (
                        <div className="flex flex-col divide-y divide-board/60">
                          {docs.map((d) => (
                            <div key={d.id} className="group/doc flex items-center gap-2 rounded-inner px-1 py-1.5 transition-colors hover:bg-hover-soft">
                              {d.kind === 'note' ? (
                                <NotebookPen size={12} className="shrink-0 text-muted" />
                              ) : (
                                <FileText size={12} className="shrink-0 text-muted" />
                              )}
                              <span className="min-w-0 flex-1 truncate font-mono text-12 text-primary" title={d.name}>
                                {d.name}
                              </span>
                              <span className="shrink-0 text-11 tabular-nums text-muted">
                                {d.chunkCount} 片段 · {Math.max(1, Math.round(d.chars / 1000))}k 字
                              </span>
                              {d.kind === 'note' && (
                                <button
                                  type="button"
                                  title="编辑笔记"
                                  onClick={() => void editNote(kb, d)}
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:text-primary group-hover/doc:opacity-100 focus-visible:opacity-100"
                                >
                                  <Pencil size={12} />
                                </button>
                              )}
                              <button
                                type="button"
                                title="移除文档"
                                onClick={() => removeDoc(d)}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:text-error group-hover/doc:opacity-100 focus-visible:opacity-100"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* 幽灵新建卡：填住网格尾位（单卡时右半不再空旷），点击聚焦顶部输入框 */}
          <button
            type="button"
            onClick={() => nameInputRef.current?.focus()}
            className={cn(
              'group/ghost animate-fundet-rise-in self-start flex min-h-[122px] flex-col items-center justify-center gap-1.5',
              'rounded-container border border-dashed border-board text-muted',
              'transition-colors duration-[var(--motion-fast)] hover:border-[var(--input-focus-border)] hover:text-secondary',
            )}
            style={{ animationDelay: `${Math.min(kbs.length, 6) * 60}ms` }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-secondary transition-transform duration-[var(--motion-base)] ease-[var(--motion-ease-move)] group-hover/ghost:scale-105">
              <Plus size={14} strokeWidth={2} />
            </span>
            <span className="text-12">新建知识库</span>
          </button>
        </div>
      )}
    </div>
  );
}
