/**
 * LongMa 调试台（/debug 保留）：功能优先，样式从简。
 * 阶段 2 的最小验证页，正式 UI 上线后仍用于 IPC 全链路复验：
 * - 设置区：provider CRUD + API key 写入
 * - 会话区：新建会话 → prompt → 流式打印原始 AgentEvent → 权限审批卡 → 中断
 * - 会话列表：切换查看历史消息
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentEventPayload,
  InteractionRequestPayload,
  MessageView,
  ProviderApi,
  ProviderView,
  SessionDetail,
  SessionListItem,
} from '../../../shared/fundet-api.js';
import { brand } from '../../../shared/brand.ts';

const sectionStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = { padding: 4, marginRight: 8, marginBottom: 4 };

function parseModels(text: string): Array<{ id: string }> {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
}

export function DebugPage(): React.JSX.Element {
  // ---------- 设置区状态 ----------
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [providerKeys, setProviderKeys] = useState<Record<string, boolean>>({});
  const [pName, setPName] = useState('');
  const [pApi, setPApi] = useState<ProviderApi>('openai-completions');
  const [pBaseUrl, setPBaseUrl] = useState('');
  const [pKey, setPKey] = useState('');
  const [pModels, setPModels] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  // ---------- 会话区状态 ----------
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selProviderId, setSelProviderId] = useState('');
  const [selModel, setSelModel] = useState('');
  const [workDir, setWorkDir] = useState('/mnt/d/AI/Fundet');
  const [prompt, setPrompt] = useState('');
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [history, setHistory] = useState<MessageView[]>([]);
  const [pending, setPending] = useState<InteractionRequestPayload[]>([]);
  const [sendError, setSendError] = useState('');
  const eventEndRef = useRef<HTMLDivElement>(null);
  // onAgentEvent 闭包里要读最新的 activeSessionId
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  const refreshProviders = useCallback(async () => {
    const list = await window.fundet.listProviders();
    setProviders(list);
    const keys: Record<string, boolean> = {};
    for (const p of list) keys[p.id] = await window.fundet.hasProviderKey(p.id);
    setProviderKeys(keys);
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await window.fundet.listSessions());
  }, []);

  useEffect(() => {
    void refreshProviders();
    void refreshSessions();
    void window.fundet.getPendingInteractions().then(setPending);

    const offEvent = window.fundet.onAgentEvent((payload: AgentEventPayload) => {
      setEventLog((prev) => {
        if (payload.sessionId !== activeSessionRef.current) return prev;
        const line = JSON.stringify({ type: payload.event.type, data: payload.event.data });
        return [...prev.slice(-499), line];
      });
    });
    const offReq = window.fundet.onInteractionRequest((p) => {
      setPending((prev) => [...prev.filter((x) => x.request.requestId !== p.request.requestId), p]);
    });
    const offDis = window.fundet.onInteractionDismissed((p) => {
      setPending((prev) => prev.filter((x) => x.request.requestId !== p.requestId));
    });
    return () => {
      offEvent();
      offReq();
      offDis();
    };
  }, []);

  useEffect(() => {
    eventEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [eventLog]);

  // ---------- 设置区动作 ----------
  const addProvider = async (): Promise<void> => {
    setSettingsMsg('');
    try {
      const models = parseModels(pModels);
      if (!pName.trim() || !pBaseUrl.trim() || models.length === 0) {
        setSettingsMsg('name / baseUrl / models 必填');
        return;
      }
      const created = await window.fundet.createProvider({
        name: pName.trim(),
        api: pApi,
        baseUrl: pBaseUrl.trim(),
        models,
      });
      if (pKey.trim()) await window.fundet.setProviderKey(created.id, pKey.trim());
      setPName('');
      setPBaseUrl('');
      setPKey('');
      setPModels('');
      await refreshProviders();
      setSettingsMsg(`已创建 provider：${created.name}`);
    } catch (err) {
      setSettingsMsg(`创建失败：${String(err)}`);
    }
  };

  const removeProvider = async (id: string): Promise<void> => {
    await window.fundet.deleteProvider(id);
    await refreshProviders();
  };

  // ---------- 会话区动作 ----------
  const createSession = async (): Promise<void> => {
    setSendError('');
    try {
      const provider = providers.find((p) => p.id === selProviderId);
      const model = selModel || provider?.models[0]?.id || '';
      if (!provider || !model || !workDir.trim()) {
        setSendError('请先选 provider / model 并填 workDir');
        return;
      }
      const meta = await window.fundet.createSession({
        workDir: workDir.trim(),
        providerId: provider.id,
        model,
        title: `调试会话 ${new Date().toLocaleTimeString()}`,
      });
      setActiveSessionId(meta.id);
      setEventLog([]);
      setHistory([]);
      await refreshSessions();
    } catch (err) {
      setSendError(`建会话失败：${String(err)}`);
    }
  };

  const send = async (): Promise<void> => {
    setSendError('');
    if (!activeSessionId || !prompt.trim()) return;
    const provider = providers.find((p) => p.id === selProviderId);
    try {
      const result = await window.fundet.sendMessage({
        sessionId: activeSessionId,
        text: prompt,
        create: provider
          ? {
              workDir: workDir.trim(),
              providerId: provider.id,
              model: selModel || provider.models[0]?.id || '',
            }
          : undefined,
      });
      if (!result.accepted) setSendError(`发送未接受：${result.reason ?? '未知'}`);
      setPrompt('');
    } catch (err) {
      setSendError(`发送失败：${String(err)}`);
    }
  };

  const abort = async (): Promise<void> => {
    if (activeSessionId) await window.fundet.abortSession(activeSessionId);
  };

  const openSession = async (id: string): Promise<void> => {
    setActiveSessionId(id);
    setEventLog([]);
    const detail: SessionDetail | null = await window.fundet.getSession(id);
    setHistory(detail?.messages ?? []);
  };

  const closeSession = async (id: string): Promise<void> => {
    await window.fundet.closeSession(id);
    await refreshSessions();
  };

  const removeSession = async (id: string): Promise<void> => {
    await window.fundet.deleteSession(id);
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setHistory([]);
      setEventLog([]);
    }
    await refreshSessions();
  };

  const resolvePermission = async (
    p: InteractionRequestPayload,
    behavior: 'allow' | 'deny',
  ): Promise<void> => {
    await window.fundet.resolveInteraction(p.request.requestId, {
      kind: 'permission',
      behavior,
      ...(behavior === 'deny' ? { reason: '用户拒绝' } : {}),
    });
  };

  const activePending = pending.filter((p) => p.sessionId === activeSessionId);
  const selProvider = providers.find((p) => p.id === selProviderId);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <h1 style={{ fontSize: 20 }}>{brand.name} 调试台</h1>

      {/* ---------- 设置区 ---------- */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Providers（BYOK）</h2>
        <div>
          <input
            style={inputStyle}
            placeholder="name"
            value={pName}
            onChange={(e) => setPName(e.target.value)}
          />
          <select
            style={inputStyle}
            value={pApi}
            onChange={(e) => setPApi(e.target.value as ProviderApi)}
          >
            <option value="openai-completions">openai-completions</option>
            <option value="openai-responses">openai-responses</option>
            <option value="anthropic-messages">anthropic-messages</option>
          </select>
          <input
            style={{ ...inputStyle, width: 260 }}
            placeholder="baseUrl（http://127.0.0.1:9 可测 keyless）"
            value={pBaseUrl}
            onChange={(e) => setPBaseUrl(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 200 }}
            placeholder="API key（loopback 可留空）"
            type="password"
            value={pKey}
            onChange={(e) => setPKey(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 220 }}
            placeholder="模型 id，逗号分隔"
            value={pModels}
            onChange={(e) => setPModels(e.target.value)}
          />
          <button onClick={() => void addProvider()}>添加</button>
        </div>
        {settingsMsg && <div style={{ color: '#666' }}>{settingsMsg}</div>}
        <ul style={{ marginBottom: 0 }}>
          {providers.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b> [{p.api}] {p.baseUrl} — 模型：
              {p.models.map((m) => m.id).join(', ')} — key：
              {providerKeys[p.id] ? '已配置' : '无'}
              <button style={{ marginLeft: 8 }} onClick={() => void removeProvider(p.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* ---------- 新建会话 ---------- */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>新建会话</h2>
        <select
          style={inputStyle}
          value={selProviderId}
          onChange={(e) => {
            setSelProviderId(e.target.value);
            setSelModel('');
          }}
        >
          <option value="">选 provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={selModel}
          onChange={(e) => setSelModel(e.target.value)}
        >
          <option value="">选 model（默认第一个）</option>
          {selProvider?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <input
          style={{ ...inputStyle, width: 320 }}
          placeholder="workDir"
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
        />
        <button onClick={() => void createSession()}>创建会话</button>
      </div>

      {/* ---------- 会话区 ---------- */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          会话 {activeSessionId ? `(${activeSessionId.slice(0, 8)}…)` : '（未选择）'}
        </h2>

        {activePending.map((p) => (
          <div
            key={p.request.requestId}
            style={{ border: '2px solid #d97706', borderRadius: 8, padding: 8, marginBottom: 8 }}
          >
            <div>
              <b>权限请求</b> kind={p.request.kind}
              {p.request.kind === 'permission' && (
                <>
                  {' '}
                  tool=<code>{p.request.toolName}</code>
                  <pre style={{ margin: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(p.request.input, null, 2)}
                  </pre>
                </>
              )}
            </div>
            {p.request.kind === 'permission' && (
              <>
                <button onClick={() => void resolvePermission(p, 'allow')}>允许</button>
                <button style={{ marginLeft: 8 }} onClick={() => void resolvePermission(p, 'deny')}>
                  拒绝
                </button>
              </>
            )}
          </div>
        ))}

        <div>
          <input
            style={{ ...inputStyle, width: 480 }}
            placeholder="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
          />
          <button onClick={() => void send()}>发送</button>
          <button style={{ marginLeft: 8 }} onClick={() => void abort()}>
            中断
          </button>
        </div>
        {sendError && <div style={{ color: '#b91c1c' }}>{sendError}</div>}

        {history.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13 }}>历史消息（DB）</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', background: '#f5f5f5', padding: 8 }}>
              {history.map((m) => (
                <div key={m.id} style={{ marginBottom: 4 }}>
                  <code>[{m.role}]</code> {m.content.slice(0, 300)}
                </div>
              ))}
            </div>
          </div>
        )}

        <h3 style={{ fontSize: 13 }}>AgentEvent 流（{eventLog.length}）</h3>
        <div style={{ maxHeight: 320, overflowY: 'auto', background: '#111', color: '#0f0', padding: 8 }}>
          {eventLog.map((line, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line}
            </div>
          ))}
          <div ref={eventEndRef} />
        </div>
      </div>

      {/* ---------- 会话列表 ---------- */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>会话列表</h2>
        <button onClick={() => void refreshSessions()}>刷新</button>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void openSession(s.id);
                }}
              >
                {s.title || s.id.slice(0, 8)}
              </a>{' '}
              [{s.status}] {s.model} — {s.workDir}
              <button style={{ marginLeft: 8 }} onClick={() => void closeSession(s.id)}>
                关闭
              </button>
              <button style={{ marginLeft: 4 }} onClick={() => void removeSession(s.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
