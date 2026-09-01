/**
 * IPC handler 注册：会话生命周期、消息发送、权限审批闭环、provider/KEY 管理。
 *
 * 事件链路：session.onEvent → 选择性落库 messages + 广播 agent:event；
 * 审批链路：session.setInteractionListener → 广播 interaction:request →
 * renderer 调 interaction:resolve → resolver resolve（permission 有 10 分钟兜底 deny）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { brand } from '../../shared/brand.js';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import type {
  AgentEvent,
  Effort,
  InteractionDecision,
  InteractionRequest,
  PermissionMode,
  Session,
  UserContentBlock,
  UserMessage,
} from '@fundet/agent-core';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { copyMessagesUntil, deleteMessagesInRange, insertMessage, listMessages } from '../db/messages.js';
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
} from '../db/providers.js';
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
  type McpServerInput,
} from '../db/mcp-servers.js';
import { deleteProviderKey, hasProviderKey, writeProviderKey } from '../host/secrets.js';
import { addUsageDelta, getUsageHistory } from '../db/usage.js';
import {
  SEARCH_ENGINES,
  isSearchEngineId,
  type SearchEngineId,
} from '../../shared/search-engines.ts';
import {
  clearSearchKey,
  getDefaultSearchEngine,
  hasSearchKey,
  readSearchKey,
  resolveSearchEngine,
  setDefaultSearchEngine,
  writeSearchKey,
} from '../search/config.ts';
import { searchWithEngine } from '../search/providers.ts';
import { fetchProviderModels } from '../host/provider-models.js';
import { getHost } from '../host/pi-host.js';
import { createConsoleLogger } from '@fundet/agent-core';
import { ensureBrowserRuntime, stopManagedRuntime } from '../browser/host.js';
import {
  clearCopiedLogins,
  listInstalledChromium,
  managedUserDataMember,
  realLoginsApplied,
  snapshotRealProfile,
  RealProfileError,
} from '../browser/real-profile.ts';
import { setSetting, getSetting } from '../db/settings.js';
import { BROWSER_ENABLED_SETTING } from '../../shared/browser-settings.ts';
import { COMPUTER_ENABLED_SETTING } from '../../shared/computer-settings.ts';
import { disableCuaDriverTelemetry, resolveCuaDriverCommand } from '../computer/driver.ts';
import { getBoolSetting, setBoolSetting } from '../db/settings.js';
import { importSkillFile, listSkills, uninstallSkill } from '../host/skills.js';
import { FUNDET_INVOKE, FUNDET_PUSH } from './channels.js';
import { resolveUnderWorkDir, stageBytesIntoWorkDir, stageFileIntoWorkDir } from '../fs-local.js';
import { documentExtractSupport, extractDocumentText } from '../doc-text.js';
import { mimeFromExt } from '../../shared/file-kind.ts';
import type {
  FetchModelsInput,
  ProviderInput,
  SessionAttachment,
  SessionCreateInput,
  SessionDetail,
  SessionListItem,
  SessionSendInput,
  SendResult,
} from '../../shared/fundet-api.js';

/** permission 审批的兜底超时：超时自动 deny，防 pi 侧永久挂起 */
const PERMISSION_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

interface PendingInteraction {
  sessionId: string;
  request: InteractionRequest;
  resolve: (decision: InteractionDecision) => void;
  timer: NodeJS.Timeout | null;
}

/** requestId → 待决审批 */
const pendingInteractions = new Map<string, PendingInteraction>();
/** 已接线（事件/审批监听）的 sessionId */
const wiredSessions = new Set<string>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** 事件落库：user/assistant 文本 + done，工具/thinking/error 事件存 JSON */
function persistEvent(sessionId: string, event: AgentEvent): void {
  try {
    switch (event.type) {
      case 'text': {
        const data = event.data as { text?: string; isFinal?: boolean };
        if (data.isFinal && data.text) insertMessage(sessionId, 'assistant', { text: data.text });
        break;
      }
      case 'thinking': {
        const data = event.data as { stage?: string; text?: string };
        if (data.stage === 'final' && data.text) {
          insertMessage(sessionId, 'thinking', { text: data.text });
        }
        break;
      }
      case 'tool_use':
      case 'tool_result':
        insertMessage(sessionId, 'tool', { kind: event.type, data: event.data });
        break;
      case 'done':
        insertMessage(sessionId, 'done', event.data);
        break;
      case 'error': {
        const data = event.data as { isTerminal?: boolean };
        if (data.isTerminal) insertMessage(sessionId, 'error', event.data);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.warn('[fundet:ipc] 事件落库失败（不阻断事件流）', err);
  }
}

/** 给 Session 装上事件转发 + 审批监听（每会话一次） */
export function wireSession(session: Session): void {
  if (wiredSessions.has(session.id)) return;
  wiredSessions.add(session.id);

  // 用量历史：turn 级增量累计。tokenUsage/costUsd 是会话累计值，做差取增量；
  // 模型归属按会话当前 model（中途换模型轻微误归属，v1 接受）
  const sessionModel =
    getDb().select({ model: sessions.model }).from(sessions).where(eq(sessions.id, session.id)).get()?.model ?? 'unknown';
  let lastTokens = 0;
  let lastCostUsd = 0;
  let lastSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  session.onEvent((event) => {
    persistEvent(session.id, event);
    const data = event.data as {
      tokenUsage?: number; costUsd?: number;
      inputTokens?: number; outputTokens?: number;
      cacheReadTokens?: number; cacheWriteTokens?: number;
    } | undefined;
    if (data && typeof data.tokenUsage === 'number') {
      const dTokens = data.tokenUsage - lastTokens;
      const dCost = typeof data.costUsd === 'number' ? data.costUsd - lastCostUsd : 0;
      // 计数器只会涨；骤降 = 会话重置，丢弃这一跳防负增量
      if (dTokens > 0 || dCost > 0) {
        try {
          addUsageDelta(sessionModel, {
            tokens: Math.max(0, dTokens),
            costUsd: Math.max(0, dCost),
            inputTokens: Math.max(0, (data.inputTokens ?? 0) - lastSplit.input),
            outputTokens: Math.max(0, (data.outputTokens ?? 0) - lastSplit.output),
            cacheReadTokens: Math.max(0, (data.cacheReadTokens ?? 0) - lastSplit.cacheRead),
            cacheWriteTokens: Math.max(0, (data.cacheWriteTokens ?? 0) - lastSplit.cacheWrite),
          });
        } catch {
          /* 用量累计失败不影响会话 */
        }
      }
      lastTokens = data.tokenUsage;
      if (typeof data.costUsd === 'number') lastCostUsd = data.costUsd;
      lastSplit = {
        input: data.inputTokens ?? lastSplit.input,
        output: data.outputTokens ?? lastSplit.output,
        cacheRead: data.cacheReadTokens ?? lastSplit.cacheRead,
        cacheWrite: data.cacheWriteTokens ?? lastSplit.cacheWrite,
      };
    }
    broadcast(FUNDET_PUSH.AGENT_EVENT, { sessionId: session.id, event });
  });

  session.onStatusChange((status) => {
    broadcast(FUNDET_PUSH.AGENT_STATUS_CHANGED, { sessionId: session.id, status });
  });

  session.setInteractionListener(
    (request) =>
      new Promise<InteractionDecision>((resolve) => {
        const entry: PendingInteraction = { sessionId: session.id, request, resolve, timer: null };
        if (request.kind === 'permission') {
          entry.timer = setTimeout(() => {
            pendingInteractions.delete(request.requestId);
            broadcast(FUNDET_PUSH.INTERACTION_DISMISSED, {
              sessionId: session.id,
              requestId: request.requestId,
              reason: 'timeout',
            });
            resolve({ kind: 'permission', behavior: 'deny', reason: '审批超时自动拒绝' });
          }, PERMISSION_INTERACTION_TIMEOUT_MS);
        }
        pendingInteractions.set(request.requestId, entry);
        broadcast(FUNDET_PUSH.INTERACTION_REQUEST, { sessionId: session.id, request });
      }),
  );

  session.onStatusChange((status) => {
    if (status === 'closed' || status === 'error') wiredSessions.delete(session.id);
  });
}

/** 取内存中的会话；不存在时按 create 参数或 DB 记录 lazy-create */
async function ensureSession(input: SessionSendInput): Promise<Session> {
  const { maker } = getHost();
  const alive = maker.getSession(input.sessionId);
  if (alive) return alive;

  let create = input.create;
  if (!create) {
    const row = getDb().select().from(sessions).where(eq(sessions.id, input.sessionId)).get();
    if (!row) throw new Error(`会话不存在且未提供创建参数: ${input.sessionId}`);
    // 从 DB 恢复会话参数（providerId 不在 SessionMeta 里 —— 本阶段重建需 renderer 传 create）
    throw new Error(
      `会话 ${input.sessionId} 不在内存（model=${row.model}）。请带 create 参数重发，或新建会话。`,
    );
  }
  // workDir 不存在时 pi spawn 会 ENOENT——提前拦截并给中文指引
  if (create.workDir && !fs.existsSync(path.resolve(create.workDir))) {
    throw new Error(
      '工作目录不存在：' + create.workDir + '。可能已被移动或删除，请用输入框旁的文件夹按钮重新选择。',
    );
  }
  const session = await maker.createSession({
    agentKind: 'pi',
    id: create.sessionId ?? input.sessionId,
    title: create.title,
    workingDir: create.workDir,
    model: create.model,
    providerId: create.providerId,
    effort: create.effort,
    permissionMode: create.permissionMode,
  });
  wireSession(session);
  return session;
}

/** 首条用户消息自动标题时要覆盖的占位值（renderer 建草稿时写入「新对话」） */
const PLACEHOLDER_TITLES = new Set(['', '新会话', '新对话']);

/** 首条用户消息落库时，用消息前 20 字做会话标题（不用 LLM）；仅覆盖占位标题 */
function autoTitleFromFirstMessage(sessionId: string, text: string): void {
  try {
    const row = getDb()
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (!row || !PLACEHOLDER_TITLES.has(row.title)) return;
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!title) return;
    getDb().update(sessions).set({ title, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  } catch (err) {
    console.warn('[fundet:ipc] 自动标题失败（不阻断发送）', err);
  }
}

function sessionRowsToList(): SessionListItem[] {
  return getDb()
    .select()
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .all()
    .map((r) => ({
      id: r.id,
      title: r.title,
      workDir: r.workDir,
      model: r.model,
      effort: r.effort,
      permissionMode: r.permissionMode,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
}

function settleInteraction(requestId: string, decision: InteractionDecision): boolean {
  const entry = pendingInteractions.get(requestId);
  if (!entry) return false;
  pendingInteractions.delete(requestId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.resolve(decision);
  broadcast(FUNDET_PUSH.INTERACTION_DISMISSED, {
    sessionId: entry.sessionId,
    requestId,
    reason: 'resolved',
  });
  return true;
}

async function buildUserMessage(
  text: string,
  attachments?: SessionAttachment[],
): Promise<UserMessage> {
  const files = attachments ?? [];
  if (files.length === 0) return { type: 'user', content: text };
  const blocks: UserContentBlock[] = [];
  if (text.trim()) blocks.push({ type: 'text', text });
  // 多篇 PDF/Word 并行提取（串行时大文件会拖慢整条发送）；保持每个
  // file 块后紧跟自己的正文块，配对顺序不变
  const extracted = await Promise.all(
    files.map(async (a) =>
      a.kind !== 'image' && documentExtractSupport(a.path)
        ? await extractDocumentText(a.path)
        : '',
    ),
  );
  files.forEach((a, i) => {
    if (a.kind === 'image') {
      blocks.push({ type: 'image', path: a.path, mimeType: a.mimeType });
    } else {
      blocks.push({ type: 'file', path: a.path, mimeType: a.mimeType });
      if (extracted[i]) blocks.push({ type: 'text', text: extracted[i] });
    }
  });
  return { type: 'user', content: blocks };
}

export function registerIpcHandlers(): void {
  // ---------- 会话 ----------
  ipcMain.handle(FUNDET_INVOKE.SESSION_CREATE, async (_e, input: SessionCreateInput) => {
    const { maker } = getHost();
    const session = await maker.createSession({
      agentKind: 'pi',
      id: input.sessionId ?? randomUUID(),
      title: input.title,
      workingDir: input.workDir,
      model: input.model,
      providerId: input.providerId,
      effort: input.effort,
      permissionMode: input.permissionMode,
    });
    wireSession(session);
    const meta = await maker.getSessionMeta(session.id);
    return meta;
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_LIST, async () => sessionRowsToList());

  ipcMain.handle(FUNDET_INVOKE.SESSION_GET, async (_e, id: string): Promise<SessionDetail | null> => {
    const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return null;
    return {
      meta: {
        id: row.id,
        title: row.title,
        workDir: row.workDir,
        model: row.model,
        effort: row.effort,
        permissionMode: row.permissionMode,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      messages: listMessages(id).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_DELETE, async (_e, id: string) => {
    const { maker } = getHost();
    if (maker.isSessionAlive(id)) await maker.closeSession(id, 'requested');
    getDb().delete(sessions).where(eq(sessions.id, id)).run();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_SEND,
    async (_e, input: SessionSendInput): Promise<SendResult> => {
      const session = await ensureSession(input);
      const attachments = input.attachments ?? [];
      insertMessage(session.id, 'user', {
        text: input.text,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      autoTitleFromFirstMessage(
        session.id,
        input.text.trim() || attachments.map((a) => a.name).join(' ') || '',
      );
      const result = await session.send(await buildUserMessage(input.text, attachments));
      return result.accepted ? { accepted: true } : { accepted: false, reason: result.reason };
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_ABORT, async (_e, id: string) => {
    const session = getHost().maker.getSession(id);
    if (session) await session.abort();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_DELETE_TURN,
    async (_e, sessionId: string, afterCreatedAt: number, untilCreatedAt: number) => {
      deleteMessagesInRange(sessionId, afterCreatedAt, untilCreatedAt);
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_FORK, async (_e, sessionId: string, upToCreatedAt: number) => {
    const row = getDb().select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row) throw new Error('会话不存在');
    const providers = listProviders();
    const provider = providers.find((p) => p.models.some((m) => m.id === row.model)) ?? providers[0];
    if (!provider) throw new Error('没有可用的 Provider，无法分叉');
    const { maker } = getHost();
    const forked = await maker.createSession({
      agentKind: 'pi',
      title: `${row.title || '会话'}（分叉）`,
      workingDir: row.workDir,
      model: row.model,
      providerId: provider.id,
      effort: (row.effort as Effort | null) ?? undefined,
      permissionMode: (row.permissionMode as PermissionMode | null) ?? undefined,
    });
    wireSession(forked);
    copyMessagesUntil(sessionId, forked.id, upToCreatedAt);
    getDb().update(sessions).set({ updatedAt: Date.now() }).where(eq(sessions.id, forked.id)).run();
    return forked.id;
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_CLOSE, async (_e, id: string) => {
    const { maker } = getHost();
    if (maker.isSessionAlive(id)) await maker.closeSession(id, 'requested');
    getDb()
      .update(sessions)
      .set({ status: 'closed', updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_SET_MODEL,
    async (_e, id: string, model: string, providerId?: string) => {
      const session = getHost().maker.getSession(id);
      if (session) {
        await session.setModel(model, providerId !== undefined ? { providerId } : undefined);
      } else {
        // 会话不在内存（重启后未发消息 / 上一轮出错被回收）：只落库，
        // 下次发送时 ensureSession 会按新 model lazy-create，不能在这里判死。
        const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
        if (!row) throw new Error(`会话不存在: ${id}`);
      }
      getDb().update(sessions).set({ model, updatedAt: Date.now() }).where(eq(sessions.id, id)).run();
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_EFFORT, async (_e, id: string, effort: Effort | null) => {
    const session = getHost().maker.getSession(id);
    // null = 回模型默认：pi 的 set_thinking_level 没有 unset，活会话本轮保持
    // 当前档位，只清库让后续/lazy-create 的会话回到模型默认
    if (session && effort !== null) {
      await session.setEffort(effort);
    } else {
      const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
      if (!row) throw new Error(`会话不存在: ${id}`);
    }
    getDb()
      .update(sessions)
      .set({ effort, updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_PERMISSION_MODE, async (_e, id: string, mode: PermissionMode) => {
    const session = getHost().maker.getSession(id);
    if (session) {
      await session.setPermissionMode(mode);
    } else {
      const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
      if (!row) throw new Error(`会话不存在: ${id}`);
    }
    getDb()
      .update(sessions)
      .set({ permissionMode: mode, updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_TITLE, async (_e, id: string, title: string) => {
    const trimmed = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!trimmed) throw new Error('标题不能为空');
    const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
    if (!row) throw new Error('会话不存在');
    // 不 bump updatedAt：改名不应把会话顶到列表最前。
    getDb().update(sessions).set({ title: trimmed }).where(eq(sessions.id, id)).run();
  });

  // ---------- 审批 ----------
  ipcMain.handle(
    FUNDET_INVOKE.INTERACTION_RESOLVE,
    async (_e, requestId: string, decision: InteractionDecision) => {
      if (!settleInteraction(requestId, decision)) {
        throw new Error(`审批请求不存在或已解决: ${requestId}`);
      }
    },
  );

  ipcMain.handle(FUNDET_INVOKE.INTERACTION_GET_PENDING, async () =>
    Array.from(pendingInteractions.values()).map((p) => ({
      sessionId: p.sessionId,
      request: p.request,
    })),
  );

  // ---------- providers ----------
  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_LIST, async () => listProviders());

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_CREATE, async (_e, input: ProviderInput) =>
    createProvider(input),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_UPDATE, async (_e, id: string, patch: Partial<ProviderInput>) =>
    updateProvider(id, patch),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_DELETE, async (_e, id: string) => {
    deleteProvider(id);
    deleteProviderKey(id);
  });

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_SET_KEY, async (_e, providerId: string, key: string) => {
    if (!key.trim()) throw new Error('API key 不能为空');
    writeProviderKey(providerId, key.trim());
  });

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_HAS_KEY, async (_e, providerId: string) =>
    hasProviderKey(providerId),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_FETCH_MODELS, async (_e, input: FetchModelsInput) =>
    fetchProviderModels(input),
  );

  // ---------- MCP servers ----------
  ipcMain.handle(FUNDET_INVOKE.MCP_LIST, async () => listMcpServers());

  ipcMain.handle(FUNDET_INVOKE.MCP_CREATE, async (_e, input: McpServerInput) =>
    createMcpServer(input),
  );

  ipcMain.handle(FUNDET_INVOKE.MCP_UPDATE, async (_e, id: string, patch: Partial<McpServerInput>) =>
    updateMcpServer(id, patch),
  );

  ipcMain.handle(FUNDET_INVOKE.MCP_DELETE, async (_e, id: string) => {
    deleteMcpServer(id);
  });

  ipcMain.handle(FUNDET_INVOKE.FS_HOME, async () => os.homedir());
  ipcMain.handle(FUNDET_INVOKE.FS_PICK_DIR, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择工作目录',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle(FUNDET_INVOKE.FS_PICK_FILES, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择文件',
      properties: ['openFile' as const, 'multiSelections' as const],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return picked.filePaths;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_STAGE_FILES, async (_e, workDir: string, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length === 0) return [];
    const out = [];
    for (const p of paths) out.push(await stageFileIntoWorkDir(String(p), workDir));
    return out;
  });

  ipcMain.handle(
    FUNDET_INVOKE.FS_STAGE_BYTES,
    async (_e, workDir: string, name: string, data: ArrayBuffer) => {
      return stageBytesIntoWorkDir(workDir, String(name || 'paste'), new Uint8Array(data));
    },
  );

  ipcMain.handle(FUNDET_INVOKE.FS_PICK_IMAGE, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择头像',
      properties: ['openFile' as const],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 4 * 1024 * 1024) throw new Error('头像超过 4MB');
    const buf = fs.readFileSync(filePath);
    const mime = mimeFromExt(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_READ_TEXT, async (_e, filePath: string, workDir: string) => {
    const resolved = resolveUnderWorkDir(filePath, workDir);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，请用系统打开');
    return fs.readFileSync(resolved, 'utf-8');
  });

  ipcMain.handle(FUNDET_INVOKE.FS_READ_DATA_URL, async (_e, filePath: string, workDir: string) => {
    const resolved = resolveUnderWorkDir(filePath, workDir);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB');
    const buf = fs.readFileSync(resolved);
    const mime = mimeFromExt(resolved);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_OPEN_PATH, async (_e, filePath: string) => {
    const resolved = path.resolve(filePath);
    const err = await shell.openPath(resolved);
    if (err) throw new Error(err);
  });

  ipcMain.handle(FUNDET_INVOKE.OPEN_EXTERNAL, async (_e, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new Error('无效链接');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('只允许打开 http(s) 链接');
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle(FUNDET_INVOKE.SEARCH_STATUS, async () => ({
    engines: SEARCH_ENGINES.map((e) => ({
      id: e.id,
      name: e.name,
      hint: e.hint,
      signupUrl: e.signupUrl,
      hasKey: hasSearchKey(e.id),
    })),
    defaultEngine: getDefaultSearchEngine(),
  }));

  ipcMain.handle(FUNDET_INVOKE.SEARCH_SET_KEY, async (_e, id: string, key: string) => {
    if (!isSearchEngineId(id)) throw new Error('未知搜索引擎');
    writeSearchKey(id, key);
    if (!getDefaultSearchEngine()) setDefaultSearchEngine(id);
  });

  ipcMain.handle(FUNDET_INVOKE.SEARCH_CLEAR_KEY, async (_e, id: string) => {
    if (!isSearchEngineId(id)) throw new Error('未知搜索引擎');
    clearSearchKey(id);
    if (getDefaultSearchEngine() === null) setDefaultSearchEngine(null);
  });

  ipcMain.handle(FUNDET_INVOKE.SEARCH_SET_DEFAULT, async (_e, id: string | null) => {
    if (id !== null && !isSearchEngineId(id)) throw new Error('未知搜索引擎');
    setDefaultSearchEngine(id);
  });

  ipcMain.handle(
    FUNDET_INVOKE.SEARCH_TEST,
    async (_e, query: string, engine?: SearchEngineId) => {
      const resolved = resolveSearchEngine(engine ?? null);
      if (!resolved) {
        return { ok: false, error: '还没有配置任何搜索 API key' };
      }
      const key = readSearchKey(resolved);
      if (!key) return { ok: false, error: `${resolved} 未配置 key` };
      const out = await searchWithEngine(resolved, key, String(query || 'LongMa'), 3);
      if (!out.ok) return { ok: false, error: out.error };
      return { ok: true, engine: out.engine, results: out.results };
    },
  );

  // ---------- 浏览器自动化 ----------
  ipcMain.handle(FUNDET_INVOKE.BROWSER_STATUS, async () => ({
    enabled: getBoolSetting(BROWSER_ENABLED_SETTING, false),
  }));

  ipcMain.handle(FUNDET_INVOKE.BROWSER_SET_ENABLED, async (_e, enabled: boolean) => {
    setBoolSetting(BROWSER_ENABLED_SETTING, Boolean(enabled));
  });

  // 登录入口：start + focus（已开则聚焦），绝不新开 tab——冷启动时 open 会开出双 tab
  ipcMain.handle(FUNDET_INVOKE.BROWSER_OPEN, async () => {
    const logger = createConsoleLogger('fundet');
    const runtime = await ensureBrowserRuntime(logger);
    if (!runtime) throw new Error('浏览器运行时不可用：本机未检测到 Chromium 系浏览器');
    await runtime.call({ action: 'start' });
    await runtime.call({ action: 'focus' });
  });

  // ---------- 用量历史 ----------
  ipcMain.handle(FUNDET_INVOKE.USAGE_HISTORY, async (_e, days?: number) => getUsageHistory(Math.min(90, Math.max(1, days ?? 30))));

  // ---------- 系统浏览器登录态 ----------
  const REAL_LOGINS_SOURCE_KEY = 'browser.realLogins.source';

  ipcMain.handle(FUNDET_INVOKE.BROWSER_REAL_LOGINS, async () => {
    const dir = managedUserDataMember().userDataDir;
    return { enabled: realLoginsApplied(dir), source: getSetting(REAL_LOGINS_SOURCE_KEY) };
  });

  ipcMain.handle(FUNDET_INVOKE.BROWSER_SET_REAL_LOGINS, async (_e, enabled: boolean) => {
    // 先停托管浏览器（锁自己的 user-data）；失败由快照阶段报 PROFILE_LOCKED
    await stopManagedRuntime();
    const dir = managedUserDataMember().userDataDir;
    if (enabled) {
      const installed = listInstalledChromium();
      if (installed.length === 0) {
        throw new Error('未检测到系统 Chrome / Edge / Brave，无法拷贝登录状态。');
      }
      try {
        const result = snapshotRealProfile({ source: installed[0], destDir: dir });
        setSetting(REAL_LOGINS_SOURCE_KEY, result.sourceKind);
      } catch (err) {
        if (err instanceof RealProfileError) throw new Error(err.message);
        throw err;
      }
    } else {
      clearCopiedLogins(dir);
      setSetting(REAL_LOGINS_SOURCE_KEY, null);
    }
  });

  // ---------- 电脑操作 ----------
  ipcMain.handle(FUNDET_INVOKE.COMPUTER_STATUS, async () => ({
    enabled: getBoolSetting(COMPUTER_ENABLED_SETTING, false),
    driverAvailable: Boolean(resolveCuaDriverCommand()),
  }));

  ipcMain.handle(FUNDET_INVOKE.COMPUTER_SET_ENABLED, async (_e, enabled: boolean) => {
    setBoolSetting(COMPUTER_ENABLED_SETTING, Boolean(enabled));
    // 开启时顺手关掉 driver 的无内容遥测（本地优先产品；异步执行，不在这个
    // IPC 里等它——telemetry 子命令可能与 mcp 子进程争全局锁，绝不能放会话装配路径）
    if (enabled) {
      const command = resolveCuaDriverCommand();
      if (command) disableCuaDriverTelemetry(command);
    }
  });

  // ---------- skills ----------
  ipcMain.handle(FUNDET_INVOKE.SKILLS_LIST, async (_e, workDir?: string) => listSkills(workDir));

  ipcMain.handle(FUNDET_INVOKE.SKILLS_PICK, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '导入技能',
      properties: ['openFile' as const],
      filters: [{ name: 'Skill', extensions: ['md', 'zip'] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle(
    FUNDET_INVOKE.SKILLS_IMPORT,
    async (_e, filePath: string, scope: 'user' | 'project', workDir?: string) =>
      importSkillFile(filePath, scope, workDir),
  );

  ipcMain.handle(FUNDET_INVOKE.SKILLS_UNINSTALL, async (_e, skillDir: string) => {
    uninstallSkill(skillDir);
  });

  ipcMain.on(FUNDET_INVOKE.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on(FUNDET_INVOKE.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(FUNDET_INVOKE.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(FUNDET_INVOKE.CLIPBOARD_WRITE_TEXT, (_e, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
  });

  ipcMain.handle(
    FUNDET_INVOKE.CLIPBOARD_CAPTURE_RECT,
    async (
      e,
      rect: { x?: number; y?: number; width?: number; height?: number },
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) throw new Error('窗口不存在');
      const bounds = {
        x: Math.max(0, Math.round(Number(rect?.x) || 0)),
        y: Math.max(0, Math.round(Number(rect?.y) || 0)),
        width: Math.max(1, Math.round(Number(rect?.width) || 0)),
        height: Math.max(1, Math.round(Number(rect?.height) || 0)),
      };
      const image = await win.webContents.capturePage(bounds);
      if (image.isEmpty()) throw new Error('截图为空');
      clipboard.writeImage(image);
    },
  );
}
