import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { Eye, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ProviderApi, ProviderView } from '../../../../shared/fundet-api.js';
import { formatTokenCount, preferScannedContextWindow } from '../../../../shared/context-window.js';
import { cn } from '../../lib/cn';
import { ProviderLogoMark } from '../icons/ProviderLogoMark';
import { AddProviderWizard } from './AddProviderWizard';

const FIELD =
  'w-full h-10 rounded-xl border border-board bg-card px-3 text-13 text-primary placeholder:text-placeholder outline-none';

const API_OPTIONS: Array<{ value: ProviderApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

function CustomProviderDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ProviderView | null;
  onSaved: (id?: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [api, setApi] = useState<ProviderApi>('openai-completions');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<Array<{ id: string; contextWindow?: number; maxTokens?: number; input?: Array<'text' | 'image'> }>>([{ id: '' }]);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setKey('');
    setName(editing?.name ?? '');
    setApi(editing?.api ?? 'openai-completions');
    setBaseUrl(editing?.baseUrl ?? '');
    setModels(
      editing?.models.length
        ? editing.models.map((m) => ({
            id: m.id,
            contextWindow: preferScannedContextWindow(m.id, m.contextWindow),
            ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
            ...(m.input ? { input: m.input } : {}),
          }))
        : [{ id: '' }],
    );
  }, [open, editing]);

  const scan = async (): Promise<void> => {
    if (!baseUrl.trim() || (!key.trim() && !editing)) return;
    setFetching(true);
    setError('');
    try {
      const r = await window.fundet.fetchProviderModels({
        baseUrl: baseUrl.trim(),
        api,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(editing ? { providerId: editing.id } : {}),
      });
      if (!r.ok || !r.models) {
        setError(r.error || '未能列出模型');
        return;
      }
      setModels(
        r.models.map((m) => ({
          id: m.id,
          contextWindow: preferScannedContextWindow(m.id, m.contextWindow),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  const save = async (): Promise<void> => {
    const modelSpecs = models
      .map((m) => ({
        id: m.id.trim(),
        ...(m.contextWindow && m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.input ? { input: m.input } : {}),
        enabled: true as const,
      }))
      .filter((m) => m.id);
    if (!name.trim() || !baseUrl.trim() || modelSpecs.length === 0) {
      setError('名称、Base URL、至少一个模型 id 必填');
      return;
    }
    try {
      if (editing) {
        await window.fundet.updateProvider(editing.id, {
          name: name.trim(),
          api,
          baseUrl: baseUrl.trim(),
          models: modelSpecs,
        });
        if (key.trim()) await window.fundet.setProviderKey(editing.id, key.trim());
        onSaved(editing.id);
      } else {
        const created = await window.fundet.createProvider({
          name: name.trim(),
          api,
          baseUrl: baseUrl.trim(),
          models: modelSpecs,
        });
        if (key.trim()) await window.fundet.setProviderKey(created.id, key.trim());
        onSaved(created.id);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay-modal)]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(520px,100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-board bg-card p-4">
          <Dialog.Title className="text-15 font-medium text-primary">
            {editing ? '编辑供应商' : '自定义端点'}
          </Dialog.Title>
          <div className="mt-3 flex flex-col gap-2.5">
            <input className={FIELD} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
            <select className={FIELD} value={api} onChange={(e) => setApi(e.target.value as ProviderApi)}>
              {API_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input className={FIELD} placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <input
              className={FIELD}
              type="password"
              placeholder={editing ? 'API key（留空沿用已保存）' : 'API key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button type="button" className="self-start text-12 text-secondary" onClick={() => void scan()}>
              {fetching ? '扫描中…' : '扫描模型'}
            </button>
            <div className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto">
              {models.map((m, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    className={FIELD}
                    value={m.id}
                    placeholder="模型 id"
                    onChange={(e) =>
                      setModels((cur) => cur.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))
                    }
                  />
                  <label className="flex w-[64px] shrink-0 cursor-pointer items-center gap-1 text-12 text-secondary">
                    <input
                      type="checkbox"
                      checked={(m.input ?? []).includes('image')}
                      onChange={(e) =>
                        setModels((cur) =>
                          cur.map((x, j) =>
                            j === i
                              ? { ...x, input: e.target.checked ? ['text', 'image'] : ['text'] }
                              : x,
                          ),
                        )
                      }
                    />
                    视觉
                  </label>
                  <input
                    className={cn(FIELD, 'w-[110px]')}
                    value={m.contextWindow ? String(m.contextWindow) : ''}
                    placeholder="上下文"
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setModels((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, contextWindow: raw ? Number(raw) : undefined } : x)),
                      );
                    }}
                  />
                </div>
              ))}
            </div>
            <button type="button" className="self-start text-12 text-secondary" onClick={() => setModels((c) => [...c, { id: '' }])}>
              + 添加模型
            </button>
            {error && <p className="text-12 text-error">{error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="rounded-full border border-board px-4 py-1.5 text-13">
                取消
              </button>
            </Dialog.Close>
            <button type="button" onClick={() => void save()} className="rounded-full bg-accent px-4 py-1.5 text-13 text-accent-fg">
              保存
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ProvidersPanel(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [keyMap, setKeyMap] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState('');

  const refresh = useCallback(async (preferId?: string): Promise<void> => {
    const list = await window.fundet.listProviders();
    setProviders(list);
    const keys: Record<string, boolean> = {};
    for (const p of list) keys[p.id] = await window.fundet.hasProviderKey(p.id);
    setKeyMap(keys);
    setSelectedId((cur) => {
      if (preferId && list.some((p) => p.id === preferId)) return preferId;
      if (cur && list.some((p) => p.id === cur)) return cur;
      return list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  const saveKey = async (): Promise<void> => {
    if (!selected || !keyDraft.trim()) return;
    await window.fundet.setProviderKey(selected.id, keyDraft.trim());
    setKeyDraft('');
    await refresh(selected.id);
  };

  const rescan = async (): Promise<void> => {
    if (!selected) return;
    setScanning(true);
    setHint('');
    try {
      const r = await window.fundet.fetchProviderModels({
        baseUrl: selected.baseUrl,
        api: selected.api,
        providerId: selected.id,
        ...(keyDraft.trim() ? { apiKey: keyDraft.trim() } : {}),
      });
      if (!r.ok || !r.models) {
        setHint(r.error || '扫描失败');
        return;
      }
      const prev = new Map(selected.models.map((m) => [m.id, m]));
      const models = r.models.map((m) => {
        const old = prev.get(m.id);
        return {
          id: m.id,
          contextWindow: preferScannedContextWindow(m.id, m.contextWindow, old?.contextWindow),
          enabled: old?.enabled !== false,
        };
      });
      await window.fundet.updateProvider(selected.id, { models });
      setHint(`已扫描到 ${models.length} 个模型`);
      await refresh(selected.id);
    } catch (err) {
      setHint(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const toggleModel = async (modelId: string, enabled: boolean): Promise<void> => {
    if (!selected) return;
    const models = selected.models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
    await window.fundet.updateProvider(selected.id, { models });
    await refresh(selected.id);
  };

  // 视觉开关写显式 input 字段（['text','image'] / ['text']），覆盖按 id 的推断
  const toggleModelVision = async (modelId: string, vision: boolean): Promise<void> => {
    if (!selected) return;
    const models = selected.models.map((m) =>
      m.id === modelId
        ? { ...m, input: (vision ? ['text', 'image'] : ['text']) as Array<'text' | 'image'> }
        : m,
    );
    await window.fundet.updateProvider(selected.id, { models });
    await refresh(selected.id);
  };

  const remove = async (): Promise<void> => {
    if (!selected) return;
    await window.fundet.deleteProvider(selected.id);
    setMenuOpen(false);
    await refresh();
  };

  const shown = selected?.models.length ?? 0;
  const enabledCount = selected?.models.filter((m) => m.enabled !== false).length ?? 0;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h2 className="text-16 font-medium text-primary">模型供应商</h2>
        <p className="mt-1 text-13 text-secondary">选模型时使用的来源。每个供应商自己的 Key 和模型，会话里可切换。</p>
      </div>

      <div className="flex min-h-[460px] overflow-hidden rounded-xl border border-board bg-card-ivory">
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-board">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {providers.map((p) => {
              const on = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setHint('');
                    setKeyDraft('');
                    setMenuOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left',
                    on ? 'bg-chip' : 'hover:bg-hover',
                  )}
                >
                  <span className="flex h-7 w-7 items-center justify-center text-primary">
                    <ProviderLogoMark providerId={p.id} name={p.name} baseUrl={p.baseUrl} modelId={p.models[0]?.id} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-medium text-primary">{p.name}</span>
                    <span className="block text-11 text-muted">{p.models.filter((m) => m.enabled !== false).length} 个模型</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="p-2">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="flex h-9 w-full items-center justify-center gap-1 rounded-full border border-dashed border-board text-13 text-secondary hover:bg-hover"
            >
              <Plus size={14} />
              添加供应商
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {!selected ? (
            <p className="pt-10 text-center text-13 text-muted">还没有供应商，点左下角添加</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center text-primary">
                  <ProviderLogoMark
                    providerId={selected.id}
                    name={selected.name}
                    baseUrl={selected.baseUrl}
                    modelId={selected.models[0]?.id}
                    size={22}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-16 font-medium text-primary">{selected.name}</h3>
                    <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-secondary">{shown} models</span>
                    {keyMap[selected.id] ? (
                      <span className="text-11 text-muted">已连接</span>
                    ) : (
                      <span className="text-11 text-warning">缺 API key</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-12 text-muted">{selected.baseUrl}</p>
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-full p-1.5 text-muted hover:bg-hover">
                    <MoreHorizontal size={16} />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 z-10 mt-1 w-36 rounded-xl border border-board bg-card p-1 shadow-[var(--shadow-menu)]">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-13 hover:bg-hover"
                        onClick={() => {
                          setEditing(selected);
                          setCustomOpen(true);
                          setMenuOpen(false);
                        }}
                      >
                        <Pencil size={13} /> 编辑
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-13 text-error hover:bg-hover"
                        onClick={() => void remove()}
                      >
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  className={cn(FIELD, 'flex-1')}
                  type="password"
                  placeholder={keyMap[selected.id] ? '更新 API key' : '粘贴 API key'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={!keyDraft.trim()}
                  onClick={() => void saveKey()}
                  className="h-10 rounded-full bg-accent px-3 text-13 text-accent-fg disabled:opacity-40"
                >
                  保存
                </button>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-13 font-medium text-secondary">
                    显示在模型选择器 · {enabledCount}/{shown}
                  </p>
                  <button
                    type="button"
                    onClick={() => void rescan()}
                    className="flex items-center gap-1 text-12 text-secondary hover:text-primary"
                  >
                    <RefreshCw size={12} className={scanning ? 'animate-fundet-spin' : ''} />
                    {scanning ? '扫描中…' : '刷新模型'}
                  </button>
                </div>
                {hint && <p className="mb-2 text-12 text-muted">{hint}</p>}
                <div className="flex flex-col">
                  {selected.models.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 border-t border-board py-2.5 first:border-t-0">
                      <span className="min-w-0 flex-1 truncate text-14 text-primary">{m.id}</span>
                      <span className="w-14 shrink-0 text-right text-12 text-muted">
                        {m.contextWindow ? formatTokenCount(preferScannedContextWindow(m.id, m.contextWindow) ?? m.contextWindow) : ''}
                      </span>
                      <Switch.Root
                        checked={m.enabled !== false}
                        onCheckedChange={(v) => void toggleModel(m.id, v)}
                        className="h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
                      >
                        <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
                      </Switch.Root>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <AddProviderWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onOpenCustom={() => {
          setEditing(null);
          setCustomOpen(true);
        }}
        onCreated={(id) => void refresh(id)}
      />
      <CustomProviderDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        editing={editing}
        onSaved={(id) => void refresh(id)}
      />
    </div>
  );
}
