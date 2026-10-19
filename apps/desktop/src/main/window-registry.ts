/**
 * 窗口注册表：主窗显式身份 + 弹出窗登记。
 *
 * 背景（2026-10 CDS 批四）：新增会话只读弹窗后，「第一个非 pet 窗口」式推断
 * 会把弹窗误当主窗（通知点击/chime/桌宠新会话打到弹窗上）。所有主窗语义
 * 消费方一律走这里的 getMainWindow()；弹窗只登记、不参与主窗判定。
 */
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
const popoutWindows = new Map<string, BrowserWindow>();

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// ---------------------------------------------------------------------------
// 托盘隐藏节流联动（内存批 P2）：主窗 backgroundThrottling:false 常开（流式
// 不能冻结），但「关到托盘且无运行会话」时恢复节流——此前挂机的机器持续全速
// 渲染。运行数由 badge 通道喂进来（register.ts）。
// ---------------------------------------------------------------------------
let runningSessionCount = 0;

export function setRunningSessionCount(n: number): void {
  runningSessionCount = n;
  applyTrayHiddenThrottling();
}

export function applyTrayHiddenThrottling(): void {
  const win = getMainWindow();
  if (!win) return;
  if (runningSessionCount > 0 || win.isVisible()) {
    win.webContents.setBackgroundThrottling(false);
  } else {
    win.webContents.setBackgroundThrottling(true);
  }
}

/** 弹出窗登记（按会话 id 去重：同会话复用同一弹窗）。 */
export function getPopoutWindow(sessionId: string): BrowserWindow | null {
  const win = popoutWindows.get(sessionId);
  if (win && !win.isDestroyed()) return win;
  popoutWindows.delete(sessionId);
  return null;
}

export function registerPopoutWindow(sessionId: string, win: BrowserWindow): void {
  popoutWindows.set(sessionId, win);
  win.once('closed', () => {
    if (popoutWindows.get(sessionId) === win) popoutWindows.delete(sessionId);
  });
}

/** 全部弹出窗（退出清理/广播排除用）。 */
export function allPopoutWindows(): BrowserWindow[] {
  return [...popoutWindows.values()].filter((w) => !w.isDestroyed());
}

/**
 * 打开会话只读弹窗（同会话复用）。安全形态与主窗一致（同沙箱 preload /
 * contextIsolation / 链接 deny+外开）；刻意不共用 createWindow——那个会
 * 覆盖主窗引用并挂托盘「关=最小化」行为。加载 #/session-popout/<id> 路由。
 */
export function openSessionPopoutWindow(sessionId: string): BrowserWindow {
  const existing = getPopoutWindow(sessionId);
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }
  const chrome =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 16 } }
      : process.platform === 'win32'
        ? { frame: false as const }
        : {};
  const win = new BrowserWindow({
    width: 760,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: '会话',
    show: false,
    backgroundColor: '#1b1b19',
    ...chrome,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  registerPopoutWindow(sessionId, win);
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  win.once('ready-to-show', () => win.show());
  if (devUrl) {
    void win.loadURL(`${devUrl}/#/session-popout/${encodeURIComponent(sessionId)}`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: `/session-popout/${encodeURIComponent(sessionId)}`,
    });
  }
  return win;
}
