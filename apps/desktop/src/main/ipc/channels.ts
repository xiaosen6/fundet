/**
 * IPC channel 常量统一收口，禁止字符串散落。
 * 命名规则：'<域>:<动作>'（kebab-case）。push 类（main → renderer）单独立组。
 * 本文件只做常量，不得 import electron / node 模块 —— preload 与 renderer 也会引用。
 */

/** invoke 族（renderer → main，ipcRenderer.invoke） */
export const FUNDET_INVOKE = {
  SESSION_CREATE: 'session:create',
  SESSION_LIST: 'session:list',
  SESSION_GET: 'session:get',
  SESSION_DELETE: 'session:delete',
  SESSION_SEND: 'session:send',
  SESSION_ABORT: 'session:abort',
  SESSION_CLOSE: 'session:close',
  SESSION_DELETE_TURN: 'session:delete-turn',
  SESSION_FORK: 'session:fork',
  SESSION_SET_MODEL: 'session:set-model',
  SESSION_SET_EFFORT: 'session:set-effort',
  SESSION_SET_PERMISSION_MODE: 'session:set-permission-mode',
  SESSION_SET_TITLE: 'session:set-title',
  INTERACTION_RESOLVE: 'interaction:resolve',
  INTERACTION_GET_PENDING: 'interaction:get-pending',
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_CREATE: 'providers:create',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_DELETE: 'providers:delete',
  PROVIDERS_SET_KEY: 'providers:set-key',
  PROVIDERS_HAS_KEY: 'providers:has-key',
  PROVIDERS_FETCH_MODELS: 'providers:fetch-models',
  MCP_LIST: 'mcp:list',
  MCP_CREATE: 'mcp:create',
  MCP_UPDATE: 'mcp:update',
  MCP_DELETE: 'mcp:delete',
  SKILLS_LIST: 'skills:list',
  SKILLS_PICK: 'skills:pick',
  SKILLS_IMPORT: 'skills:import',
  SKILLS_UNINSTALL: 'skills:uninstall',
  FS_HOME: 'fs:home',
  FS_PICK_DIR: 'fs:pick-dir',
  FS_PICK_FILES: 'fs:pick-files',
  FS_PICK_IMAGE: 'fs:pick-image',
  FS_STAGE_FILES: 'fs:stage-files',
  FS_STAGE_BYTES: 'fs:stage-bytes',
  FS_READ_TEXT: 'fs:read-text',
  FS_READ_DATA_URL: 'fs:read-data-url',
  FS_OPEN_PATH: 'fs:open-path',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  CLIPBOARD_CAPTURE_RECT: 'clipboard:capture-rect',
  SEARCH_STATUS: 'search:status',
  SEARCH_SET_KEY: 'search:set-key',
  SEARCH_CLEAR_KEY: 'search:clear-key',
  SEARCH_SET_DEFAULT: 'search:set-default',
  SEARCH_TEST: 'search:test',
  BROWSER_STATUS: 'browser:status',
  USAGE_HISTORY: 'usage:history',
  BROWSER_SET_ENABLED: 'browser:set-enabled',
  BROWSER_OPEN: 'browser:open',
  BROWSER_REAL_LOGINS: 'browser:real-logins',
  BROWSER_SET_REAL_LOGINS: 'browser:set-real-logins',
  COMPUTER_STATUS: 'computer:status',
  COMPUTER_SET_ENABLED: 'computer:set-enabled',
  OPEN_EXTERNAL: 'shell:open-external',
  IM_STATUS: 'im:status',
  IM_SAVE: 'im:save',
  IM_CLEAR: 'im:clear',
  IM_CONNECT: 'im:connect',
  IM_DISCONNECT: 'im:disconnect',
  IM_WECHAT_QR_START: 'im:wechat-qr-start',
  IM_WECHAT_QR_CANCEL: 'im:wechat-qr-cancel',
  IM_SET_DEFAULTS: 'im:set-defaults',
  UPDATE_STATUS: 'update:status',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
} as const;

/** push 族（main → renderer，webContents.send 广播） */
export const FUNDET_PUSH = {
  /** 所有流式事件：payload { sessionId, event } */
  AGENT_EVENT: 'agent:event',
  /** 会话运行态变化：payload { sessionId, status } */
  AGENT_STATUS_CHANGED: 'agent:status-changed',
  /** 权限/问答/计划审批请求：payload { sessionId, request } */
  INTERACTION_REQUEST: 'interaction:request',
  /** 审批已收敛（被本端或其它端解决）：payload { sessionId, requestId, reason } */
  INTERACTION_DISMISSED: 'interaction:dismissed',
  SESSION_LIST_CHANGED: 'session:list-changed',
  IM_STATUS_CHANGED: 'im:status-changed',
  /** 更新状态变化：payload = UpdateState */
  UPDATE_STATUS_CHANGED: 'update:status-changed',
} as const;
