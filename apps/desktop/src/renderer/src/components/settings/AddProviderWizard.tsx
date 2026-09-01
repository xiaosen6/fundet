import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { formatTokenCount, preferScannedContextWindow } from '../../../../shared/context-window.js';
import { cn } from '../../lib/cn';
import { PROVIDER_PRESETS, type ProviderPreset } from '../../lib/providerPresets';
import { ProviderLogoMark } from '../icons/ProviderLogoMark';

const FIELD =
  'w-full h-10 rounded-xl border border-board bg-card px-3 text-13 text-primary placeholder:text-placeholder outline-none';

export function AddProviderWizard({
  open,
  onOpenChange,
  onOpenCustom,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCustom: () => void;
  onCreated: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [rows, setRows] = useState<Array<{ id: string; contextWindow?: number; maxTokens?: number; input?: Array<'text' | 'image'>; checked: boolean }>>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setPreset(null);
      setName('');
      setKey('');
      setError('');
      setRows([]);
      return;
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PROVIDER_PRESETS;
    return PROVIDER_PRESETS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.baseUrl.toLowerCase().includes(q),
    );
  }, [query]);

  const pick = (p: ProviderPreset): void => {
    setPreset(p);
    setName(p.name);
    setKey('');
    setError('');
    setRows(
      p.models.map((m) => ({
        id: m.id,
        contextWindow: preferScannedContextWindow(m.id, m.contextWindow),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.input ? { input: m.input } : {}),
        checked: true,
      })),
    );
  };

  const scan = useCallback(async (): Promise<void> => {
    if (!preset || !key.trim()) return;
    setFetching(true);
    setError('');
    try {
      const r = await window.fundet.fetchProviderModels({
        baseUrl: preset.baseUrl,
        api: preset.api,
        apiKey: key.trim(),
      });
      if (!r.ok || !r.models?.length) {
        setError(r.error || '未能列出模型，将使用预设推荐');
        return;
      }
      setRows((cur) => {
        const prev = new Map(cur.map((x) => [x.id, x]));
        const next: Array<{ id: string; contextWindow?: number; maxTokens?: number; input?: Array<'text' | 'image'>; checked: boolean }> = r.models!.map((m) => {
          const old = prev.get(m.id);
          return {
            id: m.id,
            contextWindow: preferScannedContextWindow(m.id, m.contextWindow, old?.contextWindow),
            ...(old?.maxTokens ? { maxTokens: old.maxTokens } : {}),
            ...(old?.input ? { input: old.input } : {}),
            checked: old?.checked ?? Boolean(preset.models.some((x) => x.id === m.id)),
          };
        });
        for (const x of cur) {
          if (!next.some((n) => n.id === x.id)) next.push(x);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [preset, key]);

  useEffect(() => {
    if (!preset || !key.trim()) return;
    const t = setTimeout(() => void scan(), 500);
    return () => clearTimeout(t);
  }, [preset, key, scan]);

  const save = async (): Promise<void> => {
    if (!preset) return;
    const models = rows
      .filter((r) => r.checked && r.id.trim())
      .map((r) => ({
        id: r.id.trim(),
        ...(r.contextWindow ? { contextWindow: r.contextWindow } : {}),
        ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}),
        ...(r.input ? { input: r.input } : {}),
        enabled: true,
      }));
    if (!name.trim() || models.length === 0) {
      setError('名称和至少一个模型必填');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await window.fundet.createProvider({
        name: name.trim(),
        api: preset.api,
        baseUrl: preset.baseUrl,
        models,
      });
      if (key.trim()) await window.fundet.setProviderKey(created.id, key.trim());
      onCreated(created.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay-modal)]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(640px,calc(100vh-48px))] w-[min(520px,100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-board bg-card">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-board px-3">
            {preset ? (
              <button type="button" onClick={() => setPreset(null)} className="text-muted hover:text-primary">
                <ArrowLeft size={16} />
              </button>
            ) : null}
            <Dialog.Title className="text-14 font-medium text-primary">
              {preset ? preset.name : '添加供应商'}
            </Dialog.Title>
          </div>

          {!preset ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="px-3 pt-3">
                <div className="flex h-10 items-center gap-2 rounded-xl border border-board bg-card px-3">
                  <Search size={14} className="text-muted" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-13 outline-none"
                    placeholder="搜索供应商"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-hover"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-board bg-chip text-primary">
                      <ProviderLogoMark name={p.name} baseUrl={p.baseUrl} modelId={p.models[0]?.id} size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-13 font-medium text-primary">{p.name}</span>
                    <span className="shrink-0 text-11 text-muted">API Key</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenCustom();
                  }}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-hover"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-board text-primary">
                    <Plus size={14} />
                  </span>
                  <span className="text-13 font-medium text-primary">自定义端点</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名称" />
              <input className={cn(FIELD, 'font-mono text-12')} value={preset.baseUrl} readOnly />
              <input
                className={FIELD}
                type="password"
                placeholder="API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              {preset.docsUrl ? (
                <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="text-12 text-secondary underline">
                  获取 Key 的文档
                </a>
              ) : null}
              <p className="text-12 text-secondary">{fetching ? '扫描模型中…' : '填入 Key 后自动扫描模型'}</p>
              <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-board p-1.5">
                {rows.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 rounded-inner px-2 py-1.5 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={(e) =>
                        setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, checked: e.target.checked } : x)))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-12 text-primary">{r.id}</span>
                    {r.contextWindow ? (
                      <span className="text-11 text-muted">{formatTokenCount(r.contextWindow)}</span>
                    ) : null}
                  </label>
                ))}
              </div>
              {error && <p className="text-12 text-error">{error}</p>}
              <div className="mt-auto flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-full border border-board px-4 py-1.5 text-13"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-full bg-accent px-4 py-1.5 text-13 text-accent-fg disabled:opacity-40"
                >
                  {saving ? '保存中…' : '完成'}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
