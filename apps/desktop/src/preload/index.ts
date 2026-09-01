/**
 * Fundet preload bridge：contextBridge 暴露类型化 `window.fundet` API。
 *
 * push 订阅用 fan-out 模式：每个 channel 只有一个 ipcRenderer.on 绑定，
 * 多个 renderer 订阅者共享；最后一个解订阅时才 removeListener。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { FUNDET_INVOKE, FUNDET_PUSH } from '../main/ipc/channels.js';
import type {
  AgentEventPayload,
  FundetApi,
  InteractionDismissedPayload,
  InteractionRequestPayload,
  StatusChangedPayload,
} from '../shared/fundet-api.js';

type Listener = (payload: never) => void;

type BoundHandler = (event: Electron.IpcRendererEvent, payload: unknown) => void;

/** channel → 订阅者集合；首个订阅者才绑 ipcRenderer.on */
const subscriptions = new Map<string, { listeners: Set<Listener>; bound: BoundHandler }>();

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  let sub = subscriptions.get(channel);
  if (!sub) {
    const wrapped: BoundHandler = (_event, payload) => {
      for (const listener of subscriptions.get(channel)?.listeners ?? []) {
        (listener as (p: unknown) => void)(payload);
      }
    };
    ipcRenderer.on(channel, wrapped);
    sub = { listeners: new Set(), bound: wrapped };
    subscriptions.set(channel, sub);
  }
  const listener = cb as Listener;
  sub.listeners.add(listener);
  return () => {
    const current = subscriptions.get(channel);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      ipcRenderer.removeListener(channel, current.bound);
      subscriptions.delete(channel);
    }
  };
}

const api: FundetApi = {
  createSession: (input) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_CREATE, input),
  listSessions: () => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_LIST),
  getSession: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_GET, id),
  deleteSession: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_DELETE, id),
  sendMessage: (input) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_SEND, input),
  abortSession: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_ABORT, id),
  closeSession: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_CLOSE, id),
  deleteTurn: (sessionId, afterCreatedAt, untilCreatedAt) =>
    ipcRenderer.invoke(FUNDET_INVOKE.SESSION_DELETE_TURN, sessionId, afterCreatedAt, untilCreatedAt),
  forkSession: (sessionId, upToCreatedAt) =>
    ipcRenderer.invoke(FUNDET_INVOKE.SESSION_FORK, sessionId, upToCreatedAt),
  setSessionModel: (id, model, providerId) =>
    ipcRenderer.invoke(FUNDET_INVOKE.SESSION_SET_MODEL, id, model, providerId),
  setSessionEffort: (id, effort) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_SET_EFFORT, id, effort),
  setSessionPermissionMode: (id, mode) =>
    ipcRenderer.invoke(FUNDET_INVOKE.SESSION_SET_PERMISSION_MODE, id, mode),
  renameSession: (id, title) => ipcRenderer.invoke(FUNDET_INVOKE.SESSION_SET_TITLE, id, title),

  resolveInteraction: (requestId, decision) =>
    ipcRenderer.invoke(FUNDET_INVOKE.INTERACTION_RESOLVE, requestId, decision),
  getPendingInteractions: () => ipcRenderer.invoke(FUNDET_INVOKE.INTERACTION_GET_PENDING),

  listProviders: () => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_LIST),
  createProvider: (input) => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_CREATE, input),
  updateProvider: (id, patch) => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_UPDATE, id, patch),
  deleteProvider: (id) => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_DELETE, id),
  setProviderKey: (providerId, key) =>
    ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_SET_KEY, providerId, key),
  hasProviderKey: (providerId) => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_HAS_KEY, providerId),
  fetchProviderModels: (input) => ipcRenderer.invoke(FUNDET_INVOKE.PROVIDERS_FETCH_MODELS, input),

  listMcpServers: () => ipcRenderer.invoke(FUNDET_INVOKE.MCP_LIST),
  createMcpServer: (input) => ipcRenderer.invoke(FUNDET_INVOKE.MCP_CREATE, input),
  updateMcpServer: (id, patch) => ipcRenderer.invoke(FUNDET_INVOKE.MCP_UPDATE, id, patch),
  deleteMcpServer: (id) => ipcRenderer.invoke(FUNDET_INVOKE.MCP_DELETE, id),

  listSkills: (workDir) => ipcRenderer.invoke(FUNDET_INVOKE.SKILLS_LIST, workDir),
  pickSkillFile: () => ipcRenderer.invoke(FUNDET_INVOKE.SKILLS_PICK),
  importSkill: (filePath, scope, workDir) =>
    ipcRenderer.invoke(FUNDET_INVOKE.SKILLS_IMPORT, filePath, scope, workDir),
  uninstallSkill: (skillDir) => ipcRenderer.invoke(FUNDET_INVOKE.SKILLS_UNINSTALL, skillDir),

  searchStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.SEARCH_STATUS),
  setSearchEngineKey: (id, key) => ipcRenderer.invoke(FUNDET_INVOKE.SEARCH_SET_KEY, id, key),
  clearSearchEngineKey: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SEARCH_CLEAR_KEY, id),
  setDefaultSearchEngine: (id) => ipcRenderer.invoke(FUNDET_INVOKE.SEARCH_SET_DEFAULT, id),
  testSearch: (query, engine) => ipcRenderer.invoke(FUNDET_INVOKE.SEARCH_TEST, query, engine),

  usageHistory: (days) => ipcRenderer.invoke(FUNDET_INVOKE.USAGE_HISTORY, days),

  browserStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.BROWSER_STATUS),
  setBrowserEnabled: (enabled) => ipcRenderer.invoke(FUNDET_INVOKE.BROWSER_SET_ENABLED, enabled),
  openBrowserForLogin: () => ipcRenderer.invoke(FUNDET_INVOKE.BROWSER_OPEN),
  realLoginsStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.BROWSER_REAL_LOGINS),
  setRealLogins: (enabled) => ipcRenderer.invoke(FUNDET_INVOKE.BROWSER_SET_REAL_LOGINS, enabled),

  computerStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.COMPUTER_STATUS),
  setComputerEnabled: (enabled) => ipcRenderer.invoke(FUNDET_INVOKE.COMPUTER_SET_ENABLED, enabled),

  openExternal: (url) => ipcRenderer.invoke(FUNDET_INVOKE.OPEN_EXTERNAL, url),

  imStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.IM_STATUS),
  imSave: (input) => ipcRenderer.invoke(FUNDET_INVOKE.IM_SAVE, input),
  imClear: (id) => ipcRenderer.invoke(FUNDET_INVOKE.IM_CLEAR, id),
  imConnect: (id) => ipcRenderer.invoke(FUNDET_INVOKE.IM_CONNECT, id),
  imDisconnect: (id) => ipcRenderer.invoke(FUNDET_INVOKE.IM_DISCONNECT, id),
  imWechatQrStart: () => ipcRenderer.invoke(FUNDET_INVOKE.IM_WECHAT_QR_START),
  imWechatQrCancel: () => ipcRenderer.invoke(FUNDET_INVOKE.IM_WECHAT_QR_CANCEL),
  imSetDefaults: (patch) => ipcRenderer.invoke(FUNDET_INVOKE.IM_SET_DEFAULTS, patch),

  updateStatus: () => ipcRenderer.invoke(FUNDET_INVOKE.UPDATE_STATUS),
  checkUpdate: () => ipcRenderer.invoke(FUNDET_INVOKE.UPDATE_CHECK),
  installUpdate: () => ipcRenderer.invoke(FUNDET_INVOKE.UPDATE_INSTALL),

  userHome: () => ipcRenderer.invoke(FUNDET_INVOKE.FS_HOME),
  pickDirectory: () => ipcRenderer.invoke(FUNDET_INVOKE.FS_PICK_DIR),
  pickFiles: () => ipcRenderer.invoke(FUNDET_INVOKE.FS_PICK_FILES),
  pickImageDataUrl: () => ipcRenderer.invoke(FUNDET_INVOKE.FS_PICK_IMAGE),
  stageFiles: (workDir, paths) => ipcRenderer.invoke(FUNDET_INVOKE.FS_STAGE_FILES, workDir, paths),
  stageBytes: (workDir, name, data) =>
    ipcRenderer.invoke(FUNDET_INVOKE.FS_STAGE_BYTES, workDir, name, data),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file as File) || '';
    } catch {
      return '';
    }
  },
  readTextFile: (filePath, workDir) =>
    ipcRenderer.invoke(FUNDET_INVOKE.FS_READ_TEXT, filePath, workDir),
  readFileDataUrl: (filePath, workDir) =>
    ipcRenderer.invoke(FUNDET_INVOKE.FS_READ_DATA_URL, filePath, workDir),
  openPath: (filePath) => ipcRenderer.invoke(FUNDET_INVOKE.FS_OPEN_PATH, filePath),
  platform: process.platform,
  windowMinimize: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_CLOSE),
  copyText: (text) => ipcRenderer.invoke(FUNDET_INVOKE.CLIPBOARD_WRITE_TEXT, text),
  copyImageRect: (rect) => ipcRenderer.invoke(FUNDET_INVOKE.CLIPBOARD_CAPTURE_RECT, rect),

  onAgentEvent: (cb) => subscribe<AgentEventPayload>(FUNDET_PUSH.AGENT_EVENT, cb),
  onStatusChanged: (cb) => subscribe<StatusChangedPayload>(FUNDET_PUSH.AGENT_STATUS_CHANGED, cb),
  onInteractionRequest: (cb) =>
    subscribe<InteractionRequestPayload>(FUNDET_PUSH.INTERACTION_REQUEST, cb),
  onInteractionDismissed: (cb) =>
    subscribe<InteractionDismissedPayload>(FUNDET_PUSH.INTERACTION_DISMISSED, cb),
  onSessionListChanged: (cb) => subscribe(FUNDET_PUSH.SESSION_LIST_CHANGED, cb),
  onImStatusChanged: (cb) => subscribe(FUNDET_PUSH.IM_STATUS_CHANGED, cb),
  onUpdateStatusChanged: (cb) => subscribe(FUNDET_PUSH.UPDATE_STATUS_CHANGED, cb),
};

contextBridge.exposeInMainWorld('fundet', api);
