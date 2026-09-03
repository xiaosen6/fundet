/**
 * preload 暴露给 renderer 的 `window.fundet` API 契约（纯类型，无运行时代码）。
 * preload 实现它，renderer 的 fundet.d.ts 引用它。
 */
import type {
  AgentEvent,
  InteractionDecision,
  InteractionRequest,
  SessionMeta,
  Effort,
  PermissionMode,
} from '@fundet/agent-core';
import type { ImBotsStatus, ImChannelId, ImSaveInput } from './im-bots.ts';
export type { ImBotsStatus, ImChannelId, ImChannelStatus, ImSaveInput } from './im-bots.ts';
import type { BrowserStatus } from './browser-settings.ts';
export type { BrowserStatus } from './browser-settings.ts';
import type { ComputerStatus } from './computer-settings.ts';
export type { ComputerStatus } from './computer-settings.ts';

export type ProviderApi = 'anthropic-messages' | 'openai-responses' | 'openai-completions';

export interface ProviderModelSpec {
  id: string;
  reasoning?: boolean;
  /** 思考档位映射（推理模型必配，缺了 zai 系端点不发 thinking 会 1210） */
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
  /** false = 不出现在模型选择器（Cindy 式「Shown in Model Picker」） */
  enabled?: boolean;
  /** 显式声明的输入模态；只信库值（预设标注 / 编辑对话框勾选） */
  input?: Array<'text' | 'image'>;
}

export interface ProviderView {
  id: string;
  name: string;
  api: ProviderApi;
  baseUrl: string;
  models: ProviderModelSpec[];
  createdAt: number;
}

export interface ProviderInput {
  name: string;
  api: ProviderApi;
  baseUrl: string;
  models: ProviderModelSpec[];
}

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface FetchModelsInput {
  baseUrl: string;
  api: ProviderApi;
  apiKey?: string;
  providerId?: string;
}

export interface FetchModelsResult {
  ok: boolean;
  models?: DiscoveredModel[];
  error?: string;
}

export interface SessionCreateInput {
  workDir: string;
  providerId: string;
  model: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  title?: string;
  /** 指定后复用该 id（DB 已有行则不新建 row） */
  sessionId?: string;
}

/** 发给 Pi 的用户附件：image 走多模态，file 走路径引用。 */
export interface SessionAttachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  mimeType?: string;
  size?: number;
}

export interface SessionSendInput {
  sessionId: string;
  text: string;
  attachments?: SessionAttachment[];
  /** sessionId 对应的会话不在内存（或不存在）时的 lazy-create 参数 */
  create?: SessionCreateInput;
}

export interface SessionListItem {
  id: string;
  title: string;
  workDir: string;
  model: string;
  effort: string | null;
  permissionMode: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageView {
  id: string;
  role: string;
  /** JSON 字符串 */
  content: string;
  createdAt: number;
}

export interface SessionDetail {
  meta: SessionListItem;
  messages: MessageView[];
}

export interface AgentEventPayload {
  sessionId: string;
  event: AgentEvent;
}

export interface StatusChangedPayload {
  sessionId: string;
  status: string;
}

/** 应用更新状态（主进程 updater.ts 是唯一真源） */
export interface UpdateState {
  currentVersion: string;
  /** idle / checking / latest / downloading / ready(已下载待重启) / manual(mac 去页面下载) / error */
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'manual' | 'error';
  /** 新版本号（有更新时） */
  version?: string;
  /** 下载进度 0-100（仅 Windows 自动下载） */
  progress?: number;
  error?: string;
  /** Release 页地址（mac 手动下载用） */
  releaseUrl: string;
}

export interface InteractionRequestPayload {
  sessionId: string;
  request: InteractionRequest;
}

export interface InteractionDismissedPayload {
  sessionId: string;
  requestId: string;
  reason: string;
}

export interface SendResult {
  accepted: boolean;
  reason?: string;
}

export type McpServerType = 'stdio' | 'http';

export interface McpServerView {
  id: string;
  name: string;
  type: McpServerType;
  command: string | null;
  args: string[];
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface McpServerInput {
  name: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface SkillView {
  name: string;
  description: string;
  scope: 'user' | 'repo';
  path: string;
  workDir?: string;
  bundled?: boolean;
}

export type SearchEngineId = 'tavily' | 'brave' | 'bocha' | 'zhipu';

export interface SearchEngineStatus {
  id: SearchEngineId;
  name: string;
  hint: string;
  signupUrl: string;
  hasKey: boolean;
}

export interface SearchStatus {
  engines: SearchEngineStatus[];
  defaultEngine: SearchEngineId | null;
}

export interface SearchTestResult {
  ok: boolean;
  engine?: SearchEngineId;
  results?: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
}

export interface FundetApi {
  createSession(input: SessionCreateInput): Promise<SessionMeta>;
  listSessions(): Promise<SessionListItem[]>;
  getSession(id: string): Promise<SessionDetail | null>;
  deleteSession(id: string): Promise<void>;
  sendMessage(input: SessionSendInput): Promise<SendResult>;
  abortSession(id: string): Promise<void>;
  closeSession(id: string): Promise<void>;
  deleteTurn(sessionId: string, afterCreatedAt: number, untilCreatedAt: number): Promise<void>;
  forkSession(sessionId: string, upToCreatedAt: number): Promise<string>;
  setSessionModel(id: string, model: string, providerId?: string): Promise<void>;
  setSessionEffort(id: string, effort: Effort | null): Promise<void>;
  setSessionPermissionMode(id: string, mode: PermissionMode): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;

  resolveInteraction(requestId: string, decision: InteractionDecision): Promise<void>;
  getPendingInteractions(): Promise<InteractionRequestPayload[]>;

  listProviders(): Promise<ProviderView[]>;
  createProvider(input: ProviderInput): Promise<ProviderView>;
  updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderView>;
  deleteProvider(id: string): Promise<void>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  hasProviderKey(providerId: string): Promise<boolean>;
  fetchProviderModels(input: FetchModelsInput): Promise<FetchModelsResult>;

  listMcpServers(): Promise<McpServerView[]>;
  createMcpServer(input: McpServerInput): Promise<McpServerView>;
  updateMcpServer(id: string, patch: Partial<McpServerInput>): Promise<McpServerView>;
  deleteMcpServer(id: string): Promise<void>;

  listSkills(workDir?: string): Promise<SkillView[]>;
  pickSkillFile(): Promise<string | null>;
  importSkill(filePath: string, scope: 'user' | 'project', workDir?: string): Promise<SkillView>;
  uninstallSkill(skillDir: string): Promise<void>;

  searchStatus(): Promise<SearchStatus>;
  setSearchEngineKey(id: SearchEngineId, key: string): Promise<void>;
  clearSearchEngineKey(id: SearchEngineId): Promise<void>;
  setDefaultSearchEngine(id: SearchEngineId | null): Promise<void>;
  testSearch(query: string, engine?: SearchEngineId): Promise<SearchTestResult>;

  usageHistory(days?: number): Promise<Array<{ day: string; model: string; tokens: number; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>>;

  browserStatus(): Promise<BrowserStatus>;
  setBrowserEnabled(enabled: boolean): Promise<void>;
  /** 打开/拉起托管浏览器窗口（登录用）：start + focus，绝不新开 tab */
  openBrowserForLogin(): Promise<void>;
  realLoginsStatus(): Promise<{ enabled: boolean; source: string | null }>;
  /** 开=拷系统浏览器登录态进托管浏览器；关=清除。需停托管浏览器后操作 */
  setRealLogins(enabled: boolean): Promise<void>;

  computerStatus(): Promise<ComputerStatus>;
  setComputerEnabled(enabled: boolean): Promise<void>;

  openExternal(url: string): Promise<void>;

  imStatus(): Promise<ImBotsStatus>;
  imSave(input: ImSaveInput): Promise<void>;
  imClear(id: ImChannelId): Promise<void>;
  imConnect(id: ImChannelId): Promise<void>;
  imDisconnect(id: ImChannelId): Promise<void>;
  imWechatQrStart(): Promise<string>;
  imWechatQrCancel(): Promise<void>;
  imSetDefaults(patch: { workDir?: string; providerId?: string; model?: string }): Promise<void>;

  updateStatus(): Promise<UpdateState>;
  checkUpdate(): Promise<void>;
  /** Windows：重启并安装已下载的更新；macOS：打开 Release 下载页 */
  installUpdate(): Promise<void>;

  userHome(): Promise<string>;
  pickDirectory(): Promise<string | null>;
  pickFiles(): Promise<string[] | null>;
  pickImageDataUrl(): Promise<string | null>;
  stageFiles(workDir: string, paths: string[]): Promise<SessionAttachment[]>;
  stageBytes(workDir: string, name: string, data: ArrayBuffer): Promise<SessionAttachment>;
  /** Electron 拖入的 File 的本地路径；没有路径时返回空串。 */
  getPathForFile(file: Blob): string;
  readTextFile(filePath: string, workDir: string): Promise<string>;
  readFileDataUrl(filePath: string, workDir: string): Promise<string>;
  openPath(filePath: string): Promise<void>;
  platform: NodeJS.Platform;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  copyText(text: string): Promise<void>;
  copyImageRect(rect: { x: number; y: number; width: number; height: number }): Promise<void>;

  /** push 订阅；均返回解订阅函数 */
  onAgentEvent(cb: (payload: AgentEventPayload) => void): () => void;
  onStatusChanged(cb: (payload: StatusChangedPayload) => void): () => void;
  onInteractionRequest(cb: (payload: InteractionRequestPayload) => void): () => void;
  onInteractionDismissed(cb: (payload: InteractionDismissedPayload) => void): () => void;
  onSessionListChanged(cb: () => void): () => void;
  onImStatusChanged(cb: (payload: ImBotsStatus) => void): () => void;
  onUpdateStatusChanged(cb: (payload: UpdateState) => void): () => void;
}
