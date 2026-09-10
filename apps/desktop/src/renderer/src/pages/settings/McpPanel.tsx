/**
 * McpPanel —— 设置 → MCP 服务器。
 *
 * 用户自配外部 MCP server（stdio 命令 / streamable-http），开着的在**新会话**
 * 注入给助手（工具名 mcp__<名称>__<工具>），审批跟会话权限三档走。主进程的
 * 配置存储、校验与注入链（mcp-bridge）已就绪，本面板只是它的用户面。
 */
import { useCallback, useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { McpServerInput, McpServerType, McpServerView, McpStatusResult } from '../../../../shared/fundet-api.js';

type ProbeState = { state: 'checking' | 'ok' | 'fail'; error?: string };

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

const inputCls =
  'h-9 w-full rounded-lg border border-board bg-card px-3 text-13 text-primary placeholder:text-muted focus:border-accent focus:outline-none';

/** 参数行按空白切分；header 行按第一个冒号切 Key: Value，非法行忽略并提示。 */
function parseArgs(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean);
}

function parseHeaders(raw: string): { headers: Record<string, string>; bad: boolean } {
  const headers: Record<string, string> = {};
  let bad = false;
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      bad = true;
      continue;
    }
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { headers, bad };
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

interface DraftState {
  id: string | null;
  type: McpServerType;
  name: string;
  command: string;
  args: string;
  url: string;
  headers: string;
}

const EMPTY_DRAFT: DraftState = { id: null, type: 'stdio', name: '', command: '', args: '', url: '', headers: '' };

function draftFromView(s: McpServerView): DraftState {
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    command: s.command ?? '',
    args: s.args.join(' '),
    url: s.url ?? '',
    headers: formatHeaders(s.headers),
  };
}

export function McpPanel(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});

  const refresh = useCallback(async (): Promise<void> => {
    setServers(await window.fundet.listMcpServers());
  }, []);

  const probeOne = useCallback(async (s: McpServerView): Promise<void> => {
    setProbes((m) => ({ ...m, [s.id]: { state: 'checking' } }));
    let result: McpStatusResult;
    try {
      result = await window.fundet.checkMcpServer(s.id);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    setProbes((m) => ({ ...m, [s.id]: result.ok ? { state: 'ok' } : { state: 'fail', error: result.error } }));
  }, []);

  const probeAll = useCallback(
    async (list: McpServerView[]): Promise<void> => {
      await Promise.all(list.filter((s) => s.enabled).map((s) => probeOne(s)));
    },
    [probeOne],
  );

  useEffect(() => {
    void refresh().then(() => undefined);
  }, [refresh]);

  // 列表变化后自动探测启用中的 server（跳过正在编辑的暂存项）
  useEffect(() => {
    if (servers.length > 0) void probeAll(servers);
  }, [servers, probeAll]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    setError('');
    const name = draft.name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError('名称只能含字母 / 数字 / _ / -（会拼进工具名）');
      return;
    }
    const input: McpServerInput = { name, type: draft.type, enabled: true };
    if (draft.type === 'stdio') {
      if (!draft.command.trim()) {
        setError('stdio 类型必须填写命令');
        return;
      }
      input.command = draft.command.trim();
      input.args = parseArgs(draft.args);
    } else {
      if (!draft.url.trim()) {
        setError('http 类型必须填写 url');
        return;
      }
      const { headers, bad } = parseHeaders(draft.headers);
      if (bad) {
        setError('header 行格式应为 Key: Value');
        return;
      }
      input.url = draft.url.trim();
      input.headers = headers;
    }
    setBusy(true);
    try {
      if (draft.id) await window.fundet.updateMcpServer(draft.id, input);
      else await window.fundet.createMcpServer(input);
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (s: McpServerView, enabled: boolean): void => {
    setServers((list) => list.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    void window.fundet.updateMcpServer(s.id, { enabled }).then(refresh).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      void refresh();
    });
  };

  const remove = (s: McpServerView): void => {
    if (!window.confirm(`删除 MCP 服务器「${s.name}」？进行中的会话不受影响，新会话不再注入。`)) return;
    void window.fundet.deleteMcpServer(s.id).then(refresh).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>MCP 服务器</SectionTitle>
          <p className="mt-1 text-13 text-secondary">
            挂载你自己的 MCP 工具（stdio 命令或 http 端点），开启的在**新会话**注入给助手，
            工具名形如 mcp__名称__工具，审批跟会话权限档走。stdio 命令在本机以你的身份执行，只添加你信任的来源。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            title="重新检测连通性"
            disabled={servers.length === 0}
            onClick={() => void probeAll(servers)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-board text-secondary hover:text-primary disabled:opacity-40"
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setError('');
              setDraft({ ...EMPTY_DRAFT });
            }}
            className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
          >
            <Plus size={13} />
            添加服务器
          </button>
        </div>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}

      {draft && (
        <div className="flex flex-col gap-3 rounded-xl border border-board bg-card-ivory p-4">
          <div className="flex items-center gap-2">
            {(['stdio', 'http'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDraft({ ...draft, type: t })}
                className={`h-7 rounded-full px-3 text-12 font-medium ${
                  draft.type === t ? 'bg-accent text-accent-fg' : 'border border-board text-secondary'
                }`}
              >
                {t === 'stdio' ? '本机命令（stdio）' : '远程端点（http）'}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-12 text-secondary">名称（字母 / 数字 / _ / -）</span>
            <input
              className={inputCls}
              value={draft.name}
              placeholder="my-tools"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {draft.type === 'stdio' ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">命令</span>
                <input
                  className={inputCls}
                  value={draft.command}
                  placeholder="npx"
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">参数（按空白分隔，可留空）</span>
                <input
                  className={inputCls}
                  value={draft.args}
                  placeholder="-y @example/mcp-server"
                  onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">URL（非本机必须是 https）</span>
                <input
                  className={inputCls}
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">Headers（每行一条 Key: Value，可留空）</span>
                <textarea
                  className={`${inputCls} h-20 py-2 font-mono`}
                  value={draft.headers}
                  placeholder={'Authorization: Bearer sk-...'}
                  onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
                />
              </label>
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="h-8 rounded-full bg-accent px-4 text-12 font-medium text-accent-fg disabled:opacity-50"
            >
              {draft.id ? '保存修改' : '添加'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="h-8 rounded-full border border-board px-4 text-12 text-secondary"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 && !draft ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有配置。添加一个 MCP server 后，新会话即可使用它的工具。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusDot state={probes[s.id]} enabled={s.enabled} />
                  <span className={`truncate text-14 font-medium ${s.enabled ? 'text-primary' : 'text-muted'}`}>
                    {s.name}
                  </span>
                  <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">
                    {s.type === 'stdio' ? '本机命令' : '远程端点'}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-11 text-muted">
                  {s.type === 'stdio' ? [s.command, ...s.args].join(' ') : s.url}
                </p>
                {s.enabled && probes[s.id]?.state === 'fail' && (
                  <p className="mt-0.5 truncate text-11 text-error" title={probes[s.id]?.error}>
                    连接失败：{probes[s.id]?.error}
                  </p>
                )}
              </div>
              <button
                type="button"
                title="编辑"
                onClick={() => {
                  setError('');
                  setDraft(draftFromView(s));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-primary"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                title="删除"
                onClick={() => remove(s)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-error"
              >
                <Trash2 size={14} />
              </button>
              <Switch.Root
                checked={s.enabled}
                onCheckedChange={(v) => toggle(s, v)}
                className="mt-1 h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
              >
                <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
              </Switch.Root>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 连接状态点：绿=握手成功 / 红=失败 / 灰=检测中或已停用 */
function StatusDot({ state, enabled }: { state?: ProbeState; enabled: boolean }): React.JSX.Element {
  const cls =
    !enabled
      ? 'bg-chip'
      : state?.state === 'ok'
        ? 'bg-success'
        : state?.state === 'fail'
          ? 'bg-error'
          : 'bg-chip animate-pulse';
  const title = !enabled ? '已停用' : state?.state === 'ok' ? '已连接' : state?.state === 'fail' ? (state.error ?? '连接失败') : '检测中…';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={title} />;
}
