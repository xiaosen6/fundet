/** 浏览器自动化共享常量（主进程 + 渲染层） */
export const BROWSER_MCP_SERVER_NAME = 'browser';
/** 设置表里的开关 key */
export const BROWSER_ENABLED_SETTING = 'browser.enabled';

export interface BrowserStatus {
  enabled: boolean;
  /** 本机是否检测到 Chromium 系浏览器（设置页展示用；探测不启动任何进程） */
  chromeAvailable: boolean;
}
