import { useCallback, useEffect, useState } from 'react';
import type { SearchEngineId, SearchStatus } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.ts';

const FIELD =
  'w-full h-10 rounded-xl border border-board bg-card px-3 text-13 text-primary placeholder:text-placeholder outline-none focus-visible:border-[var(--input-focus-border)]';

export function SearchPanel(): React.JSX.Element {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.fundet.searchStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (id: SearchEngineId): Promise<void> => {
    const key = (drafts[id] ?? '').trim();
    if (!key) {
      setError('请先粘贴 API key');
      return;
    }
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await window.fundet.setSearchEngineKey(id, key);
      setDrafts((d) => ({ ...d, [id]: '' }));
      await refresh();
      setNotice('已保存。新开的对话即可用这个引擎搜索。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (id: SearchEngineId): Promise<void> => {
    setBusy(id);
    setError('');
    try {
      await window.fundet.clearSearchEngineKey(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: SearchEngineId): Promise<void> => {
    setBusy(`test-${id}`);
    setError('');
    setNotice('');
    try {
      const out = await window.fundet.testSearch(`${brand.name} desktop agent`, id);
      if (!out.ok) setError(out.error || '测试失败');
      else setNotice(`${id} 可用，返回 ${out.results?.length ?? 0} 条。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <p className="text-13 text-muted">加载搜索设置…</p>;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h2 className="text-16 leading-[1.2] font-medium text-primary">搜索</h2>
        <p className="mt-1 text-13 text-secondary">
          和聊天模型分开。填任意一家的 API key 后，智能体即可调用联网搜索（工具名
          mcp__search__web_search）。未填 key 时搜索会提示来此配置。
        </p>
      </div>

      <div className="rounded-xl border border-board bg-card-ivory p-5">
        <p className="text-13 font-medium text-secondary">默认引擎</p>
        <select
          className={cn(FIELD, 'mt-2 max-w-sm')}
          value={status.defaultEngine ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            void window.fundet
              .setDefaultSearchEngine(v ? (v as SearchEngineId) : null)
              .then(refresh);
          }}
        >
          <option value="">（自动：第一个已填 key 的引擎）</option>
          {status.engines.map((eng) => (
            <option key={eng.id} value={eng.id} disabled={!eng.hasKey}>
              {eng.name}
              {eng.hasKey ? '' : '（未配置）'}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-12 text-error">{error}</p>}
      {notice && <p className="text-12 text-secondary">{notice}</p>}

      {status.engines.map((eng) => (
        <div key={eng.id} className="rounded-xl border border-board bg-card-ivory p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-14 font-medium text-primary">{eng.name}</p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-11',
                    eng.hasKey ? 'bg-chip text-secondary' : 'bg-hover-soft text-muted',
                  )}
                >
                  {eng.hasKey ? '已配置' : '未配置'}
                </span>
              </div>
              <p className="mt-1 text-12 text-secondary">{eng.hint}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
              onClick={() => void window.fundet.openExternal(eng.signupUrl)}
            >
              获取 Key
            </button>
          </div>
          <input
            className={cn(FIELD, 'mt-3')}
            type="password"
            autoComplete="off"
            placeholder={eng.hasKey ? '已保存。要更换请粘贴新 key' : '粘贴 API key'}
            value={drafts[eng.id] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [eng.id]: e.target.value }))}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              className="h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40"
              onClick={() => void save(eng.id)}
            >
              保存
            </button>
            {eng.hasKey && (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  className="h-8 rounded-full border border-board px-3 text-12 text-primary disabled:opacity-40"
                  onClick={() => void test(eng.id)}
                >
                  {busy === `test-${eng.id}` ? '测试中…' : '测试'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  className="h-8 rounded-full px-3 text-12 text-muted hover:text-error disabled:opacity-40"
                  onClick={() => void clear(eng.id)}
                >
                  清除
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
