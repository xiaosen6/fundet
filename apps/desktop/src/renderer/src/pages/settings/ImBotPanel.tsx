import { useCallback, useEffect, useState } from 'react';
import type { ImBotsStatus, ImChannelId, ImChannelStatus, ProviderView } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.ts';

const FIELD =
  'w-full h-10 rounded-xl border border-board bg-card px-3 text-13 text-primary placeholder:text-placeholder outline-none focus-visible:border-[var(--input-focus-border)]';

function kindLabel(kind: ImChannelStatus['kind']): string {
  if (kind === 'connected') return '已连接';
  if (kind === 'connecting') return '连接中';
  if (kind === 'error') return '出错';
  return '未配置';
}

export function ImBotPanel(): React.JSX.Element {
  const [status, setStatus] = useState<ImBotsStatus | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [im, list] = await Promise.all([window.fundet.imStatus(), window.fundet.listProviders()]);
    setStatus(im);
    setProviders(list);
  }, []);

  useEffect(() => {
    void refresh();
    return window.fundet.onImStatusChanged((next) => setStatus(next));
  }, [refresh]);

  const save = async (ch: ImChannelStatus): Promise<void> => {
    const fields = drafts[ch.id] ?? {};
    setBusy(ch.id);
    setError('');
    setNotice('');
    try {
      await window.fundet.imSave({ id: ch.id, fields });
      setDrafts((d) => ({ ...d, [ch.id]: {} }));
      await refresh();
      setNotice(`${ch.name} 已保存并尝试连接。电脑要开着${brand.name}，消息才会进智能体。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (id: ImChannelId): Promise<void> => {
    setBusy(id);
    try {
      await window.fundet.imClear(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const wechatQr = async (): Promise<void> => {
    setBusy('wechat');
    setError('');
    try {
      await window.fundet.imWechatQrStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <p className="text-13 text-muted">加载 IM 设置…</p>;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h2 className="text-16 leading-[1.2] font-medium text-primary">IM 机器人</h2>
        <p className="mt-1 text-13 text-secondary">
          用你自己的账号或机器人，凭证只存在本机。私聊或群里 @ {brand.name}，任务在这台电脑上跑，结果回到消息串。电脑要开着应用。
        </p>
      </div>

      <div className="rounded-xl border border-board bg-card-ivory p-5">
        <p className="text-13 font-medium text-secondary">IM 会话默认</p>
        <p className="mt-1 text-12 text-muted">IM 里开的对话走自动审批，工作目录和模型如下。不填则用用户主目录 / 第一个已配 key 的供应商。</p>
        <label className="mt-3 block text-12 text-muted">工作目录</label>
        <div className="mt-1 flex gap-2">
          <input className={FIELD} readOnly value={status.workDir || '（用户数据目录 / im-workspace）'} />
          <button
            type="button"
            className="h-10 shrink-0 rounded-xl border border-board px-3 text-12"
            onClick={() => {
              void window.fundet.pickDirectory().then(async (dir) => {
                if (!dir) return;
                await window.fundet.imSetDefaults({ workDir: dir });
                await refresh();
              });
            }}
          >
            选择
          </button>
        </div>
        {providers.length > 0 && (
          <>
            <label className="mt-3 block text-12 text-muted">模型</label>
            <select
              className={cn(FIELD, 'mt-1')}
              value={status.providerId && status.model ? `${status.providerId}::${status.model}` : ''}
              onChange={(e) => {
                const [providerId, model] = e.target.value.split('::');
                void window.fundet.imSetDefaults({ providerId, model }).then(refresh);
              }}
            >
              <option value="">（自动：第一个已填 key 的供应商）</option>
              {providers.flatMap((p) =>
                p.models
                  .filter((m) => m.enabled !== false)
                  .map((m) => (
                    <option key={`${p.id}::${m.id}`} value={`${p.id}::${m.id}`}>
                      {p.name} / {m.id}
                    </option>
                  )),
              )}
            </select>
          </>
        )}
      </div>

      {error && <p className="text-12 text-error">{error}</p>}
      {notice && <p className="text-12 text-secondary">{notice}</p>}

      {status.channels.map((ch) => (
        <div key={ch.id} className="rounded-xl border border-board bg-card-ivory p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-14 font-medium text-primary">{ch.name}</p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-11',
                    ch.kind === 'connected'
                      ? 'bg-chip text-secondary'
                      : ch.kind === 'error'
                        ? 'bg-hover-soft text-error'
                        : 'bg-hover-soft text-muted',
                  )}
                >
                  {kindLabel(ch.kind)}
                </span>
              </div>
              <p className="mt-1 text-12 text-secondary">{ch.hint}</p>
              {ch.detail && (
                <p className={cn('mt-1 text-12', ch.kind === 'error' ? 'text-error' : 'text-secondary')}>
                  {ch.detail}
                </p>
              )}
            </div>
            {ch.signupUrl && !ch.qr && (
              <button
                type="button"
                className="shrink-0 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
                onClick={() => void window.fundet.openExternal(ch.signupUrl)}
              >
                开放平台
              </button>
            )}
          </div>

          {ch.qr ? (
            <div className="mt-3 flex flex-col gap-3">
              {ch.qrUrl?.startsWith('data:') ? (
                <img
                  src={ch.qrUrl}
                  alt="微信登录二维码"
                  className="h-44 w-44 rounded-xl border border-board bg-card p-2"
                />
              ) : ch.kind === 'connecting' ? (
                <p className="text-12 text-muted">正在获取二维码…</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  className="h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40"
                  onClick={() => void wechatQr()}
                >
                  {ch.kind === 'connecting' ? '等待扫码…' : '扫码连接'}
                </button>
                {ch.kind === 'connecting' && (
                  <button
                    type="button"
                    className="h-8 rounded-full border border-board px-3 text-12"
                    onClick={() => void window.fundet.imWechatQrCancel()}
                  >
                    取消
                  </button>
                )}
                {(ch.configured || ch.kind === 'connected') && (
                  <button
                    type="button"
                    className="h-8 rounded-full px-3 text-12 text-muted hover:text-error"
                    onClick={() => void clear(ch.id)}
                  >
                    断开并清除
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {ch.fields.map((f) => (
                <input
                  key={f.key}
                  className={cn(FIELD, 'mt-3')}
                  type={f.password ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={ch.configured ? `已保存。要更换请粘贴新的${f.label}` : f.label}
                  value={drafts[ch.id]?.[f.key] ?? ''}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [ch.id]: { ...(d[ch.id] ?? {}), [f.key]: e.target.value },
                    }))
                  }
                />
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  className="h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40"
                  onClick={() => void save(ch)}
                >
                  保存并连接
                </button>
                {ch.kind === 'connected' && (
                  <button
                    type="button"
                    className="h-8 rounded-full border border-board px-3 text-12"
                    onClick={() => void window.fundet.imDisconnect(ch.id).then(refresh)}
                  >
                    断开
                  </button>
                )}
                {ch.configured && (
                  <button
                    type="button"
                    className="h-8 rounded-full px-3 text-12 text-muted hover:text-error"
                    onClick={() => void clear(ch.id)}
                  >
                    清除
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
