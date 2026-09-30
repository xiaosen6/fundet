/**
 * MemoryPanel —— 记忆管理面板（侧栏「记忆」能力入口）。
 *
 * 卡片语言与知识库面板同款：hero 大数字 + 发丝行 + 类型过滤 chips + FTS 搜索。
 * 记忆按工作目录分仓（与桌面会话的工作目录对应；IM 会话共享主目录仓）；
 * 每条记忆是一个 .md 分片（type_title 格式），可查看/编辑/删除/新建；
 * digest 类型是助手压缩上下文时自动沉淀的摘要，只读。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Brain, Eraser, FolderOpen, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { MemoryRecordView, MemoryScopeView } from '../../../../shared/memory.ts';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../components/ui/ConfirmDialog';
import { Tooltip } from '../../components/ui/Tooltip';
import { toast } from '../../components/ui/toast';

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return iso.slice(0, 10);
}

function dirLabel(abs: string): string {
  const parts = abs.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || abs;
}

interface Draft {
  filename: string | null;
  type: string;
  name: string;
  title: string;
  description: string;
  body: string;
  readonly: boolean;
}

const EMPTY_DRAFT: Draft = {
  filename: null,
  type: 'user',
  name: '',
  title: '',
  description: '',
  body: '',
  readonly: false,
};

export function MemoryPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [scopes, setScopes] = useState<MemoryScopeView[]>([]);
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [records, setRecords] = useState<MemoryRecordView[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<Array<{ filename: string; type: string; title: string; snippet: string }> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshScopes = useCallback(async (): Promise<void> => {
    const list = await window.fundet.memoryScopes();
    setScopes(list);
    setActiveScope((cur) => cur ?? list[0]?.absWorkdir ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [{ enabled: e }] = await Promise.all([window.fundet.memoryEnabledGet()]);
        setEnabled(e);
        await refreshScopes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshScopes]);

  const refreshRecords = useCallback(async (scope: string): Promise<void> => {
    setRecords(await window.fundet.memoryList(scope));
  }, []);

  useEffect(() => {
    if (activeScope) void refreshRecords(activeScope).catch(() => setRecords([]));
  }, [activeScope, refreshRecords]);

  // FTS 搜索（300ms 防抖；空串回全列表）
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const q = query.trim();
      if (!q || !activeScope) {
        setSearchHits(null);
        return;
      }
      void window.fundet
        .memorySearch(activeScope, q)
        .then(setSearchHits)
        .catch(() => setSearchHits([]));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, activeScope]);

  const toggleEnabled = useCallback(async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      await window.fundet.memoryEnabledSet(next);
      toast.success(next ? '记忆已开启（新会话生效）' : '记忆已关闭（已存内容保留）');
    } catch (err) {
      setEnabled(!next);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openRecord = useCallback((r: MemoryRecordView): void => {
    setDraft({
      filename: r.filename,
      type: r.type,
      name: r.filename.replace(/\.md$/, '').replace(/^[a-z]+_/, ''),
      title: r.title,
      description: r.description,
      body: r.body,
      readonly: r.type === 'digest',
    });
  }, []);

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draft || !activeScope) return;
    const body = draft.body.trim();
    if (!body) {
      toast.error('先写下要记住的内容');
      return;
    }
    // 新建走「只写内容」极简流：标题/摘要自动从正文提取，用户不填表单
    const firstLine = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const isCreate = !draft.filename;
    const title =
      draft.title.trim() || (isCreate ? firstLine.slice(0, 30) || '新记忆' : draft.title.trim());
    const description =
      draft.description.trim() || body.replace(/\s+/g, ' ').trim().slice(0, 40) || title;
    // 文件名 slug 只认 [a-z0-9_-]，中文标题榨不出 → note 兜底；同名去重防撞（create 撞名会拒）
    let name = draft.name.trim() || title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
    if (isCreate) {
      let n = 2;
      const taken = new Set(records.map((r) => r.filename));
      while (taken.has(`${draft.type}_${name}.md`)) name = `${name.replace(/-\d+$/, '')}-${n++}`;
    }
    setSaving(true);
    try {
      await window.fundet.memorySave(activeScope, {
        type: draft.type,
        name,
        title,
        description,
        body,
        ...(draft.filename ? { mode: 'update' as const } : {}),
      });
      toast.success('已保存');
      setDraft(null);
      await refreshRecords(activeScope);
      await refreshScopes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, activeScope, records, refreshRecords, refreshScopes]);

  const removeRecord = useCallback(
    async (r: MemoryRecordView): Promise<void> => {
      if (!activeScope) return;
      const ok = await confirmDialog({
        title: '删除这条记忆？',
        description: `「${r.title}」将被删除，此操作不可撤销。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.fundet.memoryDelete(activeScope, r.filename);
        toast.success('已删除');
        setDraft(null);
        await refreshRecords(activeScope);
        await refreshScopes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [activeScope, refreshRecords, refreshScopes],
  );

  const totalCount = scopes.reduce((n, s) => n + s.recordCount, 0);
  const activeRecords = records;

  return (
    <div className="flex flex-col gap-4 px-5 pt-2">
      {/* ── Hero：总览 + 开关 ── */}
      <div className="fundet-surface flex flex-col gap-4 rounded-container border border-board bg-card px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-board bg-chip text-primary">
              <Brain size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-24 font-semibold tabular-nums">{totalCount}</span>
                <span className="text-13 text-secondary">条记忆 · {scopes.length} 个工作目录</span>
              </div>
              <p className="mt-0.5 truncate text-12 text-secondary" title="助手跨会话记住你的偏好、纠偏与项目上下文；对它说「记住…」即可保存">
                助手跨会话记住你的偏好与项目上下文 · 对它说「记住…」即可保存
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-xl border border-board px-3 text-12 text-secondary transition-colors hover:text-primary"
              onClick={() => void window.fundet.memoryOpenFolder(activeScope ?? undefined).catch(() => undefined)}
            >
              <FolderOpen size={13} /> 文件夹
            </button>
            {records.some((r) => r.type === 'digest') && (
              <Tooltip label="清空全部自动沉淀的压缩摘要（保留手动记忆）" side="bottom">
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-xl border border-board px-3 text-12 text-secondary transition-colors hover:text-primary"
                  onClick={() => {
                    void (async () => {
                      const ok = await confirmDialog({
                        title: '清空压缩摘要？',
                        description: '长对话压缩时自动沉淀的摘要将被删除（手动记忆不受影响），此操作不可撤销。',
                        confirmText: '清空',
                        danger: true,
                      });
                      if (!ok || !activeScope) return;
                      try {
                        const digests = records.filter((r) => r.type === 'digest');
                        for (const d of digests) await window.fundet.memoryDelete(activeScope, d.filename);
                        toast.success(`已清空 ${digests.length} 条摘要`);
                        if (activeScope) await refreshRecords(activeScope);
                        await refreshScopes();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '清空失败');
                      }
                    })();
                  }}
                >
                  <Eraser size={13} /> 清空摘要
                </button>
              </Tooltip>
            )}
            <Switch.Root
              checked={enabled}
              onCheckedChange={(v) => void toggleEnabled(v)}
              className={cn(
                'relative h-6 w-11 rounded-full border border-board transition-colors',
                enabled ? 'bg-accent text-card' : 'bg-chip text-secondary',
              )}
            >
              <Switch.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-card transition-transform duration-[var(--motion-fast)] data-[state=checked]:translate-x-6" />
            </Switch.Root>
          </div>
        </div>
        {!enabled && (
          <p className="rounded-xl border border-board bg-chip px-3 py-2 text-12 text-secondary">
            记忆已关闭：助手不再读写记忆，也不会在压缩上下文时沉淀摘要。已保存的内容都还在，随时可重新开启。
          </p>
        )}
      </div>

      {/* ── 工作目录分组（多仓时展示） ── */}
      {scopes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <button
              key={s.absWorkdir}
              type="button"
              title={s.absWorkdir}
              onClick={() => {
                setActiveScope(s.absWorkdir);
                setSearchHits(null);
                setQuery('');
              }}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-3 text-12 transition-colors',
                activeScope === s.absWorkdir
                  ? 'border-accent bg-accent text-card'
                  : 'border-board bg-card text-secondary hover:text-primary',
              )}
            >
              {dirLabel(s.absWorkdir)}
              <span className="tabular-nums opacity-70">{s.recordCount}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── 工具行：搜索 + 新建（类型分类是幕后概念，不给用户） ── */}
      <div className="flex items-center justify-end gap-2">
        <div className="relative h-8 w-56 shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-placeholder" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆…"
            className="h-8 w-full rounded-xl border border-board bg-card pl-7 pr-2 text-12 text-primary outline-none placeholder:text-placeholder"
          />
          {query && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-placeholder hover:text-primary"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!activeScope}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-accent px-3 text-12 text-primary transition-colors hover:bg-chip disabled:opacity-50"
        >
          <Plus size={13} /> 新建
        </button>
      </div>

      {/* ── 列表 ── */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-13 text-secondary">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </div>
      ) : !activeRecords.length && !searchHits ? (
        <div className="fundet-surface flex flex-col items-center gap-2 rounded-container border border-dashed border-board px-6 py-10 text-center">
          <Brain size={22} className="text-placeholder" />
          <p className="text-13 text-secondary">
            这个目录还没有记忆。对助手说「记住我喜欢简洁回答」，它会自动存进来。
          </p>
        </div>
      ) : searchHits ? (
        searchHits.length === 0 ? (
          <p className="py-6 text-center text-13 text-secondary">没有命中「{query.trim()}」的记忆</p>
        ) : (
          <div className="flex flex-col">
            {searchHits.map((h) => (
              <button
                key={h.filename}
                type="button"
                onClick={() => {
                  const r = activeRecords.find((x) => x.filename === h.filename);
                  if (r) openRecord(r);
                }}
                className="fundet-surface flex flex-col items-start gap-1 border-b border-board px-4 py-3 text-left last:rounded-b-container hover:bg-chip"
              >
                <div className="flex w-full items-center gap-2">
                  {h.type === 'digest' && (
                    <span className="shrink-0 rounded-full border border-board px-1.5 py-px text-10 text-placeholder">自动</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-13 text-primary">{h.title}</span>
                </div>
                <p className="line-clamp-2 w-full text-12 text-secondary">{h.snippet}</p>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col">
          {records.map((r) => (
            <div
              key={r.filename}
              className="fundet-surface group flex items-center gap-3 border-b border-board px-4 py-3 first:border-t last:rounded-b-container"
            >
              {r.type === 'digest' && (
                <span className="shrink-0 rounded-full border border-board px-1.5 py-px text-10 text-placeholder">自动</span>
              )}
              <button type="button" className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left" onClick={() => openRecord(r)}>
                <div className="flex w-full items-baseline gap-2">
                  <span className="min-w-0 truncate text-13 text-primary">{r.title}</span>
                  <span className="shrink-0 text-10 text-placeholder tabular-nums">
                    {relTime(r.updatedAt)} · {r.sizeBytes}B
                  </span>
                </div>
                <p className="w-full truncate text-12 text-secondary">{r.description}</p>
              </button>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {r.type !== 'digest' && (
                  <button type="button" title="编辑" className="p-1 text-secondary hover:text-primary" onClick={() => openRecord(r)}>
                    <Pencil size={13} />
                  </button>
                )}
                <button type="button" title="删除" className="p-1 text-secondary hover:text-primary" onClick={() => void removeRecord(r)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 新建/编辑弹层 ── */}
      {draft && (
        <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div className="flex max-h-[82vh] w-full max-w-[600px] flex-col overflow-hidden rounded-container border border-board bg-card shadow-[var(--shadow-menu)]">
            {/* 头部：图标 + 标题 + 一句话说明 */}
            <div className="flex items-start justify-between gap-3 px-6 pt-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-board bg-chip text-primary">
                  <Brain size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-15 font-semibold text-primary">
                    {draft.filename ? (draft.readonly ? '记忆详情' : '编辑记忆') : '新建记忆'}
                  </p>
                  {!draft.filename && (
                    <p className="mt-0.5 text-12 text-secondary">写下要让助手记住的事，它会在以后的对话里自动参考</p>
                  )}
                </div>
              </div>
              <button type="button" className="p-1 text-secondary hover:text-primary" onClick={() => setDraft(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
              {draft.readonly ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-board px-2 py-px text-11 text-placeholder">自动摘要 · 长对话压缩时沉淀</span>
                    <span className="text-11 text-placeholder tabular-nums">{relTime(records.find((r) => r.filename === draft.filename)?.updatedAt ?? '')}</span>
                  </div>
                  <pre className="whitespace-pre-wrap rounded-xl border border-board bg-chip px-4 py-3 font-mono text-12 leading-relaxed text-primary">{draft.body}</pre>
                </>
              ) : draft.filename ? (
                /* 编辑：标题 + 内容（摘要自动维护，不给用户填） */
                <>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="标题"
                    className="h-9 rounded-xl border border-board bg-card px-3 text-13 text-primary outline-none placeholder:text-placeholder"
                  />
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    className="min-h-[160px] flex-1 resize-none rounded-xl border border-board bg-card px-3 py-2.5 text-13 leading-relaxed text-primary outline-none placeholder:text-placeholder"
                  />
                </>
              ) : (
                /* 新建：就一个输入框。类型固定用户偏好、标题取第一行、摘要自动——都不让用户操心 */
                <textarea
                  autoFocus
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={'记点什么…\n\n例如：我是做运维的，回答尽量直接给具体命令\n例如：出差报销要在回来后 5 天内提交'}
                  className="min-h-[220px] resize-none rounded-container border border-board bg-card px-4 py-3 text-14 leading-relaxed text-primary outline-none placeholder:text-placeholder"
                />
              )}
            </div>

            <div className="flex items-center justify-between border-t border-board px-6 py-4">
              {draft.filename ? (
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-xl border border-board px-3 text-12 text-secondary hover:text-primary"
                  onClick={() => {
                    const target = records.find((r) => r.filename === draft.filename);
                    if (target) void removeRecord(target);
                  }}
                >
                  <Trash2 size={13} /> 删除
                </button>
              ) : (
                <span className="text-11 text-placeholder">保存在当前目录的记忆仓 · 纯本地</span>
              )}
              <div className="flex items-center gap-2">
                <button type="button" className="h-8 rounded-xl border border-board px-4 text-13 text-secondary hover:text-primary" onClick={() => setDraft(null)}>
                  取消
                </button>
                {!draft.readonly && (
                  <button
                    type="button"
                    disabled={saving || !draft.body.trim()}
                    onClick={() => void saveDraft()}
                    className="flex h-8 items-center gap-1.5 rounded-xl bg-accent px-5 text-13 text-card disabled:opacity-50"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />} 保存
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="pb-4 text-11 leading-relaxed text-placeholder">
        记忆按工作目录分仓、纯本地存储（{scopes[0]?.scopeDir ?? '应用数据目录'}）；IM 机器人与桌面默认会话共享主目录的记忆仓。
        分片为 .md 文件，可直接用任意编辑器修改。
      </p>
    </div>
  );
}
