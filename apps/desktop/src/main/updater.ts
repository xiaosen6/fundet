/**
 * 应用更新服务（GitHub Releases 单线，2026-09-16 起；GitLab feed 已随品牌
 * 配置一并移除）。electron-updater 走 electron-builder 打包时内嵌的
 * app-update.yml（github provider，公开仓免令牌）。
 * Windows 自动下载、退出即装；macOS 未签名只检测 + 引导去 Release 页。
 * 仅打包版启用；dev 态（!app.isPackaged）全部空转。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
// electron-updater 是 CJS 且 autoUpdater 挂在 getter 上，ESM 静态命名导出分析
// 扫不出来（dev 被 vite 互操作掩盖，打包版启动即炸）。必须 default import 再解构。
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

import { brand } from '../shared/brand.js';
import { FUNDET_INVOKE, FUNDET_PUSH } from './ipc/channels.js';
import type { UpdateState } from '../shared/fundet-api.js';

const RELEASES_URL = `https://github.com/${brand.updater.owner}/${brand.updater.repo}/releases`;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const state: UpdateState = {
  currentVersion: app.getVersion(),
  status: 'idle',
  releaseUrl: `${RELEASES_URL}`,
};

function setState(patch: Partial<UpdateState>): void {
  Object.assign(state, patch);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(FUNDET_PUSH.UPDATE_STATUS_CHANGED, { ...state });
  }
}

/** macOS 手动档：HEAD latest 跟随重定向拿 tag 做版本比较 */
async function checkMac(): Promise<void> {
  setState({ status: 'checking' });
  try {
    const res = await fetch(`${RELEASES_URL}/latest`, { method: 'HEAD', redirect: 'follow' });
    const latest = (res.url.split('/').pop() ?? '').replace(/^v/, '');
    if (latest && latest !== app.getVersion()) {
      setState({ status: 'manual', version: latest, releaseUrl: `${RELEASES_URL}/v${latest}` });
    } else {
      setState({ status: 'latest' });
    }
  } catch (err) {
    setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function checkWin(): Promise<void> {
  setState({ status: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
    // 没检测到新版时 electron-updater 走 update-not-available 事件收口
  } catch (err) {
    setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

const check = (): Promise<void> =>
  process.platform === 'darwin' ? checkMac() : checkWin();

export function initUpdater(): void {
  // IPC 处理器无条件注册：渲染层更新卡在 dev 也会查询，不注册会刷
  // 「No handler registered for 'update:status'」；检查/安装本身 dev 下空转。
  ipcMain.handle(FUNDET_INVOKE.UPDATE_STATUS, () => ({ ...state }));
  ipcMain.handle(FUNDET_INVOKE.UPDATE_CHECK, async () => {
    if (!app.isPackaged) {
      setState({ status: 'idle' });
      return;
    }
    await check();
  });
  ipcMain.handle(FUNDET_INVOKE.UPDATE_INSTALL, async () => {
    if (process.platform === 'darwin' && app.isPackaged) {
      await shell.openExternal(state.releaseUrl);
      return;
    }
    if (app.isPackaged && state.status === 'ready') autoUpdater.quitAndInstall();
  });

  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;

  if (process.platform === 'win32') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // 托盘退出路径也会触发安装
    autoUpdater.on('update-available', (info) => {
      setState({ status: 'downloading', version: info.version, progress: 0 });
    });
    autoUpdater.on('update-not-available', () => setState({ status: 'latest' }));
    autoUpdater.on('download-progress', (p) => {
      setState({ status: 'downloading', progress: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      setState({ status: 'ready', version: info.version, progress: 100 });
    });
    autoUpdater.on('error', (err) => {
      setState({ status: 'error', error: err.message });
    });
  }

  // 启动 5s 后首查，之后每 4 小时静默查一次
  setTimeout(() => void check(), 5000);
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
}
