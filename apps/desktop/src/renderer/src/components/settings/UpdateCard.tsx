/**
 * UpdateCard — 设置 → 通用 的版本与更新卡。
 * Windows：electron-updater 后台下载，就绪后「重启更新」；macOS 未签名只能
 * 「下载新版本」跳 Release 页。状态真源在主进程 updater.ts，靠 push 订阅同步。
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCw, Rocket } from 'lucide-react';
import type { UpdateState } from '../../../../shared/fundet-api.js';
import { brand } from '../../../../shared/brand.js';

function statusText(s: UpdateState): string {
  switch (s.status) {
    case 'checking':
      return '正在检查更新…';
    case 'latest':
      return '已是最新版本';
    case 'downloading':
      return `正在下载 ${s.version ?? ''}（${s.progress ?? 0}%）`;
    case 'ready':
      return `新版本 ${s.version ?? ''} 已就绪，重启后生效`;
    case 'manual':
      return `发现新版本 ${s.version ?? ''}，请下载安装`;
    case 'error':
      return `检查失败：${s.error ?? '未知错误'}`;
    default:
      return '';
  }
}

export function UpdateCard(): React.JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    void window.fundet.updateStatus().then(setState);
    void window.fundet.updateFeedHasToken().then(setHasToken);
    return window.fundet.onUpdateStatusChanged(setState);
  }, []);

  const saveToken = async (): Promise<void> => {
    const t = tokenDraft.trim();
    if (!t) return;
    await window.fundet.setUpdateFeedToken(t);
    setHasToken(true);
    setTokenDraft('');
    setTokenSaved(true);
  };
  const clearToken = async (): Promise<void> => {
    await window.fundet.setUpdateFeedToken('');
    setHasToken(false);
    setTokenSaved(false);
  };

  if (!state) return <p className="text-13 text-muted">读取版本信息…</p>;

  const checking = state.status === 'checking';
  const downloading = state.status === 'downloading';
  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <p className="text-13 font-medium text-secondary">版本与更新</p>
      <p className="mt-1 text-12 text-muted">
        当前版本 v{state.currentVersion}。Windows 自动下载更新，macOS 需手动下载安装。
      </p>
      {statusText(state) && (
        <p className="mt-2 text-12 text-secondary">{statusText(state)}</p>
      )}
      {downloading && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-chip">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${state.progress ?? 0}%` }}
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state.status === 'ready' ? (
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg hover:bg-accent-hover"
            onClick={() => void window.fundet.installUpdate()}
          >
            <Rocket size={13} />
            重启更新
          </button>
        ) : state.status === 'manual' ? (
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg hover:bg-accent-hover"
            onClick={() => void window.fundet.installUpdate()}
          >
            <Download size={13} />
            下载新版本
          </button>
        ) : (
          <button
            type="button"
            disabled={checking || downloading}
            className="flex h-8 items-center gap-1.5 rounded-full border border-board px-3 text-12 text-secondary hover:bg-hover disabled:opacity-40"
            onClick={() => void window.fundet.checkUpdate()}
          >
            <RefreshCw size={13} />
            检查更新
          </button>
        )}
      </div>
      {brand.updaterFeed?.requiresToken && (
        <div className="mt-3 border-t border-board pt-3">
          <p className="text-12 text-muted">
            更新源为内网 GitLab 私有项目，检查更新需要个人访问令牌（GitLab → 设置 →
            访问令牌，勾选 api 权限）。令牌只保存在本机。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="h-8 min-w-0 flex-1 rounded-lg border border-board bg-card px-3 text-12 text-primary placeholder:text-muted focus:border-accent focus:outline-none"
              value={tokenDraft}
              placeholder="glpat-…"
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveToken();
              }}
            />
            <button
              type="button"
              disabled={!tokenDraft.trim()}
              className="h-8 shrink-0 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40"
              onClick={() => void saveToken()}
            >
              保存令牌
            </button>
            {hasToken && (
              <button
                type="button"
                className="h-8 shrink-0 rounded-full border border-board px-3 text-12 text-secondary hover:bg-hover"
                onClick={() => void clearToken()}
              >
                清除
              </button>
            )}
          </div>
          <p className="mt-1 text-11 text-muted">
            {hasToken
              ? tokenSaved
                ? '令牌已保存，正在用新令牌检查更新…'
                : '已配置令牌'
              : '未配置令牌：将无法检查更新'}
          </p>
        </div>
      )}
    </div>
  );
}
