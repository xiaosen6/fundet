/**
 * Fundet preload bridge：contextBridge 暴露类型化 `window.fundet` API。
 *
 * push 订阅用 fan-out 模式：每个 channel 只有一个 ipcRenderer.on 绑定，
 * 多个 renderer 订阅者共享；最后一个解订阅时才 removeListener。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { FUNDET_INVOKE, FUNDET_PUSH } from '../main/ipc/channels.js';
import { stripIpcErrorPrefix } from '../shared/friendly-error.js';
import type {
  AgentEventPayload,
  FindResultPayload,
  FundetApi,
  InteractionDismissedPayload,
  InteractionRequestPayload,
  KbImportProgress,
  StatusChangedPayload,
} from '../shared/fundet-api.js';

type Listener = (payload: never) => void;

type BoundHandler = (event: Electron.IpcRendererEvent, payload: unknown) => void;

/**
 * ipcMain.handle 的拒绝在 renderer 侧被 Electron 包上
 * `Error invoking remote method <channel>: ` 前缀；剥掉只留业务原文，
 * 否则 UI 会裸露 IPC 实现细节。channel 名精确匹配（channel 自身含 `:`）。
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(stripIpcErrorPrefix(channel, raw));
  });
}

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
  createSession: (input) => invoke(FUNDET_INVOKE.SESSION_CREATE, input),
  sessionPrewarm: (input) => invoke(FUNDET_INVOKE.SESSION_PREWARM, input),
  sessionPrewarmDiscard: (sessionId) => invoke(FUNDET_INVOKE.SESSION_PREWARM_DISCARD, sessionId),
  listSessions: () => invoke(FUNDET_INVOKE.SESSION_LIST),
  getSession: (id) => invoke(FUNDET_INVOKE.SESSION_GET, id),
  deleteSession: (id) => invoke(FUNDET_INVOKE.SESSION_DELETE, id),
  sendMessage: (input) => invoke(FUNDET_INVOKE.SESSION_SEND, input),
  abortSession: (id) => invoke(FUNDET_INVOKE.SESSION_ABORT, id),
  closeSession: (id) => invoke(FUNDET_INVOKE.SESSION_CLOSE, id),
  deleteTurn: (sessionId, afterCreatedAt, untilCreatedAt) =>
    invoke(FUNDET_INVOKE.SESSION_DELETE_TURN, sessionId, afterCreatedAt, untilCreatedAt),
  forkSession: (sessionId, upToCreatedAt) =>
    invoke(FUNDET_INVOKE.SESSION_FORK, sessionId, upToCreatedAt),
  setSessionModel: (id, model, providerId) =>
    invoke(FUNDET_INVOKE.SESSION_SET_MODEL, id, model, providerId),
  setSessionEffort: (id, effort) => invoke(FUNDET_INVOKE.SESSION_SET_EFFORT, id, effort),
  setSessionPermissionMode: (id, mode) =>
    invoke(FUNDET_INVOKE.SESSION_SET_PERMISSION_MODE, id, mode),
  renameSession: (id, title) => invoke(FUNDET_INVOKE.SESSION_SET_TITLE, id, title),
  setSessionPinned: (id, pinned) => invoke(FUNDET_INVOKE.SESSION_SET_PINNED, id, pinned),
  reorderSessions: (ids) => invoke(FUNDET_INVOKE.SESSION_REORDER, ids),
  searchSessions: (query) => invoke(FUNDET_INVOKE.SESSION_SEARCH, query),
  listCheckpoints: (sessionId) => invoke(FUNDET_INVOKE.CHECKPOINT_LIST, sessionId),
  previewRewind: (sessionId, sha) => invoke(FUNDET_INVOKE.CHECKPOINT_PREVIEW, sessionId, sha),
  rewindTo: (sessionId, sha) => invoke(FUNDET_INVOKE.CHECKPOINT_REWIND, sessionId, sha),

  resolveInteraction: (requestId, decision) =>
    invoke(FUNDET_INVOKE.INTERACTION_RESOLVE, requestId, decision),
  getPendingInteractions: () => invoke(FUNDET_INVOKE.INTERACTION_GET_PENDING),

  listProviders: () => invoke(FUNDET_INVOKE.PROVIDERS_LIST),
  createProvider: (input) => invoke(FUNDET_INVOKE.PROVIDERS_CREATE, input),
  updateProvider: (id, patch) => invoke(FUNDET_INVOKE.PROVIDERS_UPDATE, id, patch),
  deleteProvider: (id) => invoke(FUNDET_INVOKE.PROVIDERS_DELETE, id),
  setProviderKey: (providerId, key) =>
    invoke(FUNDET_INVOKE.PROVIDERS_SET_KEY, providerId, key),
  hasProviderKey: (providerId) => invoke(FUNDET_INVOKE.PROVIDERS_HAS_KEY, providerId),
  fetchProviderModels: (input) => invoke(FUNDET_INVOKE.PROVIDERS_FETCH_MODELS, input),

  listMcpServers: () => invoke(FUNDET_INVOKE.MCP_LIST),
  createMcpServer: (input) => invoke(FUNDET_INVOKE.MCP_CREATE, input),
  updateMcpServer: (id, patch) => invoke(FUNDET_INVOKE.MCP_UPDATE, id, patch),
  deleteMcpServer: (id) => invoke(FUNDET_INVOKE.MCP_DELETE, id),
  checkMcpServer: (id) => invoke(FUNDET_INVOKE.MCP_STATUS, id),

  listKnowledgeBases: () => invoke(FUNDET_INVOKE.KB_LIST),
  backfillKnowledgeEmbeddings: (kbId) => invoke(FUNDET_INVOKE.KB_BACKFILL_EMBEDDINGS, kbId),
  createKnowledgeBase: (name, params) => invoke(FUNDET_INVOKE.KB_CREATE, name, params),
  updateKnowledgeBaseParams: (id, params) =>
    invoke(FUNDET_INVOKE.KB_UPDATE_PARAMS, id, params),
  importKnowledgeDir: (kbId, dirPath) => invoke(FUNDET_INVOKE.KB_IMPORT_DIR, kbId, dirPath),
  deleteKnowledgeBase: (id) => invoke(FUNDET_INVOKE.KB_DELETE, id),
  listKnowledgeDocs: (kbId) => invoke(FUNDET_INVOKE.KB_DOCS, kbId),
  removeKnowledgeDoc: (docId) => invoke(FUNDET_INVOKE.KB_DOC_REMOVE, docId),
  saveKnowledgeNote: (kbId, noteId, title, content) =>
    invoke(FUNDET_INVOKE.KB_NOTE_SAVE, kbId, noteId, title, content),
  getKnowledgeNoteContent: (docId) => invoke(FUNDET_INVOKE.KB_NOTE_CONTENT, docId),
  snapshotKnowledgeUrl: (kbId, url) => invoke(FUNDET_INVOKE.KB_SNAPSHOT_URL, kbId, url),
  importKnowledgeFiles: (kbId, paths) => invoke(FUNDET_INVOKE.KB_IMPORT, kbId, paths),
  searchKnowledge: (kbIds, query, limit) =>
    invoke(FUNDET_INVOKE.KB_SEARCH, kbIds, query, limit),
  pickKnowledgeFiles: () => invoke(FUNDET_INVOKE.KB_PICK),
  getSessionKnowledgeBinding: (sessionId) =>
    invoke(FUNDET_INVOKE.KB_SESSION_GET, sessionId),
  setSessionKnowledgeBinding: (sessionId, binding) =>
    invoke(FUNDET_INVOKE.KB_SESSION_SET, sessionId, binding),

  listSkills: (workDir) => invoke(FUNDET_INVOKE.SKILLS_LIST, workDir),
  pickSkillFile: () => invoke(FUNDET_INVOKE.SKILLS_PICK),
  importSkill: (filePath, scope, workDir) =>
    invoke(FUNDET_INVOKE.SKILLS_IMPORT, filePath, scope, workDir),
  uninstallSkill: (skillDir) => invoke(FUNDET_INVOKE.SKILLS_UNINSTALL, skillDir),
  setSkillEnabled: (skillDir, enabled) =>
    invoke(FUNDET_INVOKE.SKILLS_SET_ENABLED, skillDir, enabled),

  skillhubList: (params) => invoke(FUNDET_INVOKE.SKILLHUB_LIST, params),
  skillhubDetail: (slug) => invoke(FUNDET_INVOKE.SKILLHUB_DETAIL, slug),
  skillhubInstall: (slug, replace) => invoke(FUNDET_INVOKE.SKILLHUB_INSTALL, slug, replace),
  skillhubUpdates: () => invoke(FUNDET_INVOKE.SKILLHUB_UPDATES),

  automationsList: () => invoke(FUNDET_INVOKE.AUTOMATIONS_LIST),
  automationsCreate: (input) => invoke(FUNDET_INVOKE.AUTOMATIONS_CREATE, input),
  automationsUpdate: (id, input) => invoke(FUNDET_INVOKE.AUTOMATIONS_UPDATE, id, input),
  automationsDelete: (id) => invoke(FUNDET_INVOKE.AUTOMATIONS_DELETE, id),
  automationsRunNow: (id) => invoke(FUNDET_INVOKE.AUTOMATIONS_RUN_NOW, id),
  automationsRuns: (id, limit) => invoke(FUNDET_INVOKE.AUTOMATIONS_RUNS, id, limit),
  automationsSetPaused: (id, paused) => invoke(FUNDET_INVOKE.AUTOMATIONS_SET_PAUSED, id, paused),

  searchStatus: () => invoke(FUNDET_INVOKE.SEARCH_STATUS),
  voiceTranscribe: (wavBase64) => invoke(FUNDET_INVOKE.VOICE_TRANSCRIBE, wavBase64),
  voiceSpeak: (text) => invoke(FUNDET_INVOKE.VOICE_TTS, text),
  voiceGatewayStatus: () => invoke(FUNDET_INVOKE.VOICE_GATEWAY_STATUS),
  voiceGatewaySetUrl: (url) => invoke(FUNDET_INVOKE.VOICE_GATEWAY_SET_URL, url),
  voiceEnabled: () => invoke(FUNDET_INVOKE.VOICE_ENABLED),
  voiceSetEnabled: (enabled) => invoke(FUNDET_INVOKE.VOICE_SET_ENABLED, enabled),
  setSearchEngineKey: (id, key) => invoke(FUNDET_INVOKE.SEARCH_SET_KEY, id, key),
  clearSearchEngineKey: (id) => invoke(FUNDET_INVOKE.SEARCH_CLEAR_KEY, id),
  setDefaultSearchEngine: (id) => invoke(FUNDET_INVOKE.SEARCH_SET_DEFAULT, id),
  testSearch: (query, engine) => invoke(FUNDET_INVOKE.SEARCH_TEST, query, engine),

  usageHistory: (days) => invoke(FUNDET_INVOKE.USAGE_HISTORY, days),

  browserStatus: () => invoke(FUNDET_INVOKE.BROWSER_STATUS),
  setBrowserEnabled: (enabled) => invoke(FUNDET_INVOKE.BROWSER_SET_ENABLED, enabled),
  openBrowserForLogin: () => invoke(FUNDET_INVOKE.BROWSER_OPEN),
  realLoginsStatus: () => invoke(FUNDET_INVOKE.BROWSER_REAL_LOGINS),
  setRealLogins: (enabled) => invoke(FUNDET_INVOKE.BROWSER_SET_REAL_LOGINS, enabled),

  computerStatus: () => invoke(FUNDET_INVOKE.COMPUTER_STATUS),
  setComputerEnabled: (enabled) => invoke(FUNDET_INVOKE.COMPUTER_SET_ENABLED, enabled),

  openExternal: (url) => invoke(FUNDET_INVOKE.OPEN_EXTERNAL, url),

  imStatus: () => invoke(FUNDET_INVOKE.IM_STATUS),
  imSave: (input) => invoke(FUNDET_INVOKE.IM_SAVE, input),
  imClear: (id) => invoke(FUNDET_INVOKE.IM_CLEAR, id),
  imConnect: (id) => invoke(FUNDET_INVOKE.IM_CONNECT, id),
  imDisconnect: (id) => invoke(FUNDET_INVOKE.IM_DISCONNECT, id),
  imWechatQrStart: () => invoke(FUNDET_INVOKE.IM_WECHAT_QR_START),
  imWechatQrCancel: () => invoke(FUNDET_INVOKE.IM_WECHAT_QR_CANCEL),
  imSetDefaults: (patch) => invoke(FUNDET_INVOKE.IM_SET_DEFAULTS, patch),

  dwsStatus: () => invoke(FUNDET_INVOKE.DWS_STATUS),
  dwsInstall: (source) => invoke(FUNDET_INVOKE.DWS_INSTALL, source),
  dwsLogin: () => invoke(FUNDET_INVOKE.DWS_LOGIN),
  dwsLogout: () => invoke(FUNDET_INVOKE.DWS_LOGOUT),
  dwsSkillSetup: () => invoke(FUNDET_INVOKE.DWS_SKILL_SETUP),
  dwsWidgets: (force) => invoke(FUNDET_INVOKE.DWS_WIDGETS, force),
  dwsWidgetsDetail: (kind, id) => invoke(FUNDET_INVOKE.DWS_WIDGETS_DETAIL, kind, id),

  updateStatus: () => invoke(FUNDET_INVOKE.UPDATE_STATUS),
  checkUpdate: () => invoke(FUNDET_INVOKE.UPDATE_CHECK),
  installUpdate: () => invoke(FUNDET_INVOKE.UPDATE_INSTALL),
  loginItemEnabled: () => invoke(FUNDET_INVOKE.APP_GET_LOGIN_ITEM),
  setLoginItemEnabled: (enabled) => invoke(FUNDET_INVOKE.APP_SET_LOGIN_ITEM, enabled),
  findInPage: (text, opts) => invoke(FUNDET_INVOKE.FIND_START, text, opts),
  stopFindInPage: () => invoke(FUNDET_INVOKE.FIND_STOP),

  userHome: () => invoke(FUNDET_INVOKE.FS_HOME),
  pickDirectory: () => invoke(FUNDET_INVOKE.FS_PICK_DIR),
  pickFiles: () => invoke(FUNDET_INVOKE.FS_PICK_FILES),
  pickImageDataUrl: () => invoke(FUNDET_INVOKE.FS_PICK_IMAGE),
  stageFiles: (workDir, paths) => invoke(FUNDET_INVOKE.FS_STAGE_FILES, workDir, paths),
  stageBytes: (workDir, name, data) =>
    invoke(FUNDET_INVOKE.FS_STAGE_BYTES, workDir, name, data),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file as File) || '';
    } catch {
      return '';
    }
  },
  readTextFile: (filePath, workDir) =>
    invoke(FUNDET_INVOKE.FS_READ_TEXT, filePath, workDir),
  readFileDataUrl: (filePath, workDir) =>
    invoke(FUNDET_INVOKE.FS_READ_DATA_URL, filePath, workDir),
  listDir: (dir) => invoke(FUNDET_INVOKE.FS_LIST_DIR, dir),
  openPath: (filePath) => invoke(FUNDET_INVOKE.FS_OPEN_PATH, filePath),
  platform: process.platform,
  windowMinimize: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(FUNDET_INVOKE.WINDOW_CLOSE),
  setRunningBadge: (count) => ipcRenderer.send(FUNDET_INVOKE.WINDOW_SET_RUNNING_BADGE, count),
  copyText: (text) => invoke(FUNDET_INVOKE.CLIPBOARD_WRITE_TEXT, text),
  copyImageRect: (rect) => invoke(FUNDET_INVOKE.CLIPBOARD_CAPTURE_RECT, rect),
  copyPngToClipboard: (png, plainText) => invoke(FUNDET_INVOKE.CLIPBOARD_WRITE_PNG, png, plainText),

  onAgentEvent: (cb) => subscribe<AgentEventPayload>(FUNDET_PUSH.AGENT_EVENT, cb),
  onStatusChanged: (cb) => subscribe<StatusChangedPayload>(FUNDET_PUSH.AGENT_STATUS_CHANGED, cb),
  onInteractionRequest: (cb) =>
    subscribe<InteractionRequestPayload>(FUNDET_PUSH.INTERACTION_REQUEST, cb),
  onInteractionDismissed: (cb) =>
    subscribe<InteractionDismissedPayload>(FUNDET_PUSH.INTERACTION_DISMISSED, cb),
  onSessionListChanged: (cb) => subscribe(FUNDET_PUSH.SESSION_LIST_CHANGED, cb),
  onImStatusChanged: (cb) => subscribe(FUNDET_PUSH.IM_STATUS_CHANGED, cb),
  onDwsWidgetsChanged: (cb) => subscribe(FUNDET_PUSH.DWS_WIDGETS_CHANGED, cb),
  onDwsInstallProgress: (cb) => subscribe(FUNDET_PUSH.DWS_INSTALL_PROGRESS, cb),
  onUpdateStatusChanged: (cb) => subscribe(FUNDET_PUSH.UPDATE_STATUS_CHANGED, cb),
  onKbImportProgress: (cb) => subscribe<KbImportProgress>(FUNDET_PUSH.KB_IMPORT_PROGRESS, cb),
  onKbEmbedProgress: (cb) => subscribe<KbImportProgress>(FUNDET_PUSH.KB_EMBED_PROGRESS, cb),
  onFindResult: (cb) => subscribe<FindResultPayload>(FUNDET_PUSH.FIND_RESULT, cb),
};

contextBridge.exposeInMainWorld('fundet', api);
