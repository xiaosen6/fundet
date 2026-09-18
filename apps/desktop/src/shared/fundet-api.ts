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
  /** true = 自动重试重发：消息已在库里，main 跳过 insertMessage/自动标题（不重复入历史） */
  retry?: boolean;
}

export interface SessionListItem {
  id: string;
  title: string;
  workDir: string;
  model: string;
  effort: string | null;
  permissionMode: string | null;
  status: string;
  /** 置顶段（列表置顶 + 可拖拽排序） */
  pinned?: boolean;
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

/** 钉钉工作台（dws CLI）：已登录身份 */
export interface DwsProfileView {
  /** 稳定身份 corpId:userId */
  id: string;
  org?: string;
  user?: string;
  isCurrent?: boolean;
}

/** 钉钉工作台状态（主进程 host/dws.ts 是唯一真源） */
export interface DwsStatusView {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  profiles: DwsProfileView[];
  /** 已装配的 dingtalk-* 技能目录名（用户技能根下） */
  skills: string[];
}

/** 钉钉工作台动作结果（安装 / 登录引导 / 技能装配） */
export interface DwsActionResult {
  ok: boolean;
  output: string;
  /** 登录输出里的授权 URL（浏览器没自动弹时手动打开） */
  url?: string;
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

/** 知识库导入进度（kb:import-progress push） */
export interface KbImportProgress {
  kbId: string;
  /** 已完成的文件数（current 正在处理第 completed+1 个） */
  completed: number;
  total: number;
  current: string;
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

/** MCP server 连通性探测结果（initialize 握手一次） */
export interface McpStatusResult {
  ok: boolean;
  error?: string;
}

/** 本地知识库（纯 FTS5 关键词检索） */
import type {
  KnowledgeBaseParams,
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeSearchResult,
  KnowledgeImportResult,
  KnowledgeSessionBinding,
} from './knowledge.js';
export type {
  KnowledgeBaseParams,
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeSearchResult,
  KnowledgeImportResult,
  KnowledgeSessionBinding,
} from './knowledge.js';

export interface SkillView {
  name: string;
  description: string;
  scope: 'user' | 'repo';
  /** false = 已停用（目录在 skills.disabled/ 下，新会话不加载） */
  enabled?: boolean;
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

/** 页内搜索结果（webContents found-in-page 事件转发） */
export interface FindResultPayload {
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

/** 会话搜索命中（标题 LIKE + 正文 FTS5） */
export interface SessionSearchHit {
  sessionId: string;
  title: string;
  updatedAt: number;
  snippet: string;
}

/** 会话快照（每轮发送前对工作目录的 git 快照；git 不可用则列表恒空） */
export interface CheckpointInfo {
  sha: string;
  createdAt: number;
  label: string;
}

export interface RewindPreview {
  restore: string[];
  remove: string[];
}

export interface RewindResult extends RewindPreview {
  preRollbackSha: string | null;
}

/** 目录清单条目（composer @ 文件引用用） */
export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
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
  /** 置顶/取消置顶（置顶段置顶显示，可拖拽排序） */
  setSessionPinned(id: string, pinned: boolean): Promise<void>;
  /** 持久化置顶段的手动顺序（ids 按从上到下） */
  reorderSessions(ids: string[]): Promise<void>;
  /** 搜索会话（标题 + 消息正文）；空串返回空 */
  searchSessions(query: string): Promise<SessionSearchHit[]>;
  listCheckpoints(sessionId: string): Promise<CheckpointInfo[]>;
  previewRewind(sessionId: string, sha: string): Promise<RewindPreview>;
  rewindTo(sessionId: string, sha: string): Promise<RewindResult>;

  resolveInteraction(requestId: string, decision: InteractionDecision): Promise<void>;
  getPendingInteractions(): Promise<InteractionRequestPayload[]>;

  listProviders(): Promise<ProviderView[]>;
  createProvider(input: ProviderInput): Promise<ProviderView>;
  updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderView>;
  deleteProvider(id: string): Promise<void>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  hasProviderKey(providerId: string): Promise<boolean>;
  fetchProviderModels(input: FetchModelsInput): Promise<FetchModelsResult>;

  listKnowledgeBases(): Promise<KnowledgeBaseView[]>;
  createKnowledgeBase(name: string, params?: Partial<KnowledgeBaseParams>): Promise<KnowledgeBaseView>;
  updateKnowledgeBaseParams(id: string, params: Partial<KnowledgeBaseParams>): Promise<void>;
  importKnowledgeDir(kbId: string, dirPath: string): Promise<KnowledgeImportResult[]>;
  deleteKnowledgeBase(id: string): Promise<void>;
  listKnowledgeDocs(kbId: string): Promise<KnowledgeDocView[]>;
  removeKnowledgeDoc(docId: string): Promise<void>;
  saveKnowledgeNote(kbId: string, noteId: string | null, title: string, content: string): Promise<KnowledgeDocView>;
  getKnowledgeNoteContent(docId: string): Promise<string | null>;
  snapshotKnowledgeUrl(kbId: string, url: string): Promise<KnowledgeDocView>;
  importKnowledgeFiles(kbId: string, paths: string[]): Promise<KnowledgeImportResult[]>;
  searchKnowledge(kbIds: string[], query: string, limit?: number): Promise<KnowledgeSearchResult[]>;
  pickKnowledgeFiles(): Promise<string[]>;
  getSessionKnowledgeBinding(sessionId: string): Promise<KnowledgeSessionBinding>;
  setSessionKnowledgeBinding(sessionId: string, binding: { ids: string[]; auto: boolean }): Promise<void>;

  listMcpServers(): Promise<McpServerView[]>;
  createMcpServer(input: McpServerInput): Promise<McpServerView>;
  updateMcpServer(id: string, patch: Partial<McpServerInput>): Promise<McpServerView>;
  deleteMcpServer(id: string): Promise<void>;
  /** 对 server 跑一次 initialize 握手，返回连通性（stdio 冷启动最长等 10s） */
  checkMcpServer(id: string): Promise<McpStatusResult>;

  listSkills(workDir?: string): Promise<SkillView[]>;
  pickSkillFile(): Promise<string | null>;
  importSkill(filePath: string, scope: 'user' | 'project', workDir?: string): Promise<SkillView>;
  uninstallSkill(skillDir: string): Promise<void>;
  /** 停用/启用：把技能目录在 skills/ 与 skills.disabled/ 之间移动（pi 只扫 skills/） */
  setSkillEnabled(skillDir: string, enabled: boolean): Promise<void>;

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

  /** 钉钉工作台（dws）：探测安装/登录/技能装配状态 */
  dwsStatus(): Promise<DwsStatusView>;
  /** 安装官方 dws CLI（默认 Gitee 镜像；github 走官方仓 raw） */
  dwsInstall(source: 'gitee' | 'github'): Promise<DwsActionResult>;
  /** 拉起可见终端窗口跑 dws auth login（浏览器自动开） */
  dwsLogin(): Promise<DwsActionResult>;
  /** 装配官方技能包到用户技能根（dingtalk-* 前缀目录） */
  dwsSkillSetup(): Promise<DwsActionResult>;

  updateStatus(): Promise<UpdateState>;
  checkUpdate(): Promise<void>;
  /** Windows：重启并安装已下载的更新；macOS：打开 Release 下载页 */
  installUpdate(): Promise<void>;

  /** 页内搜索（Electron findInPage，全文高亮） */
  /** 系统开机自启（打包版；dev 态恒 false 且不可开启） */
  loginItemEnabled(): Promise<boolean>;
  setLoginItemEnabled(enabled: boolean): Promise<void>;
  findInPage(text: string, opts?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<void>;
  /** 停止搜索并清除高亮 */
  stopFindInPage(): Promise<void>;

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
  /** 列目录（deny-list 策略同预览；跳隐藏/node_modules；上限 500 条） */
  listDir(dir: string): Promise<DirEntry[]>;
  openPath(filePath: string): Promise<void>;
  platform: NodeJS.Platform;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  /** 任务栏/Dock 徽标：正在跑 turn 的会话数（0 清除） */
  setRunningBadge(count: number): void;
  copyText(text: string): Promise<void>;
  copyImageRect(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
  /** 分享卡片：PNG 字节 + 可选纯文本备选，一次写入剪贴板（主进程校验 PNG） */
  copyPngToClipboard(png: ArrayBuffer, plainText?: string): Promise<void>;

  /** push 订阅；均返回解订阅函数 */
  onAgentEvent(cb: (payload: AgentEventPayload) => void): () => void;
  onStatusChanged(cb: (payload: StatusChangedPayload) => void): () => void;
  onInteractionRequest(cb: (payload: InteractionRequestPayload) => void): () => void;
  onInteractionDismissed(cb: (payload: InteractionDismissedPayload) => void): () => void;
  onSessionListChanged(cb: () => void): () => void;
  onImStatusChanged(cb: (payload: ImBotsStatus) => void): () => void;
  onKbImportProgress(cb: (payload: KbImportProgress) => void): () => void;
  onFindResult(cb: (payload: FindResultPayload) => void): () => void;
  onUpdateStatusChanged(cb: (payload: UpdateState) => void): () => void;
}
