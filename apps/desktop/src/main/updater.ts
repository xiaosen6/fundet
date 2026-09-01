/**
 * 应用更新服务：Windows 走 electron-updater（GitHub Releases，后台下载、退出即装）；
 * macOS 未签名，electron-updater 拒绝替换安装，只做版本检测 + 引导去 Release 页下载。
 * 仅打包版启用；dev 态（!app.isPackaged）全部空转。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
// electron-updater 是 CJS 且 autoUpdater 挂在 getter 上，ESM 静态命名导出分析
// 扫不出来（dev 被 vite 互操作掩盖，打包版启动即炸）。必须 default import 再解构。
import electronUpdater from 'electron-updater';
import { FUNDET_INVOKE, FUNDET_PUSH } from './ipc/channels.js';
import type { UpdateState } from '../shared/fundet-api.js';

const { autoUpdater } = electronUpdater;

import { brand } from '../shared/brand.js';

const RELEASES_URL = `https://github.com/${brand.updater.owner}/${brand.updater.repo}/releases`;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const state: UpdateState = {
  currentVersion: app.getVersion(),
  status: 'idle',
  releaseUrl: `${RELEASES_URL}/latest`,
};

function setState(patch: Partial<UpdateState>): void {
  Object.assign(state, patch);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(FUNDET_PUSH.UPDATE_STATUS_CHANGED, { ...state });
  }
}

/** macOS 手动档：跟 releases/latest 的重定向拿最新 tag 名做版本比较 */
async function checkMac(): Promise<void> {
  setState({ status: 'checking' });
  try {
    const res = await fetch(`${RELEASES_URL}/latest`, { method: 'HEAD', redirect: 'follow' });
    const tag = res.url.split('/').pop() ?? '';
    const latest = tag.replace(/^v/, '');
    if (latest && latest !== app.getVersion()) {
      setState({ status: 'manual', version: latest, releaseUrl: res.url });
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

export function initUpdater(): void {
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

  ipcMain.handle(FUNDET_INVOKE.UPDATE_STATUS, () => ({ ...state }));
  ipcMain.handle(FUNDET_INVOKE.UPDATE_CHECK, async () => {
    if (process.platform === 'darwin') await checkMac();
    else await checkWin();
  });
  ipcMain.handle(FUNDET_INVOKE.UPDATE_INSTALL, async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal(state.releaseUrl);
      return;
    }
    if (state.status === 'ready') autoUpdater.quitAndInstall();
  });

  // 启动 5s 后首查，之后每 4 小时静默查一次
  const check = process.platform === 'darwin' ? checkMac : checkWin;
  setTimeout(() => void check(), 5000);
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
}
