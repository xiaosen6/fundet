/**
 * 应用更新服务。
 * - Fundet：generic provider 指内网 GitLab Release 的 stable permalink（版本无关），
 *   latest.yml / 安装包按 filepath 挂在 Release 资产上相对解析；项目私有，
 *   检查更新需要个人访问令牌（scope=api，safeStorage 落盘，FUNDET_UPDATER_TOKEN
 *   环境变量可覆盖——部署/测试用）。
 * - 无 updaterFeed 的品牌（longma 底座）：维持 GitHub Releases 行为。
 * - Windows 自动下载、退出即装；macOS 未签名只检测 + 引导去 Release 页。
 * 仅打包版启用；dev 态（!app.isPackaged）全部空转。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
// electron-updater 是 CJS 且 autoUpdater 挂在 getter 上，ESM 静态命名导出分析
// 扫不出来（dev 被 vite 互操作掩盖，打包版启动即炸）。必须 default import 再解构。
import electronUpdater from 'electron-updater';
import { FUNDET_INVOKE, FUNDET_PUSH } from './ipc/channels.js';
import type { UpdateState } from '../shared/fundet-api.js';
import { deleteProviderKey, readProviderKey, writeProviderKey } from './host/secrets.js';

const { autoUpdater } = electronUpdater;

import { brand } from '../shared/brand.js';

/** safeStorage 里的更新令牌键（与 BYOK key 同规格，不进数据库/日志） */
const UPDATER_TOKEN_KEY = 'gitlab-updater';

const RELEASES_URL =
  brand.updaterFeed?.releasePage ??
  `https://github.com/${brand.updater.owner}/${brand.updater.repo}/releases`;
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

/** 更新令牌：环境变量覆盖 > safeStorage */
function readUpdaterToken(): string | null {
  const env = process.env['FUNDET_UPDATER_TOKEN'];
  if (env && env.trim()) return env.trim();
  return readProviderKey(UPDATER_TOKEN_KEY);
}

/**
 * 两跳解析 GitLab generic feed：先查最新 Release tag，再指
 * /releases/<tag>/downloads/（latest.yml 与安装包按 filepath 挂链）。
 * 失败时置错误态并返回 false（本次检查终止，不打到 GitHub 旧源）。
 */
async function resolveGitLabTag(): Promise<string | null> {
  const feed = brand.updaterFeed;
  if (!feed) return null;
  const token = readUpdaterToken();
  const headers = token ? { 'PRIVATE-TOKEN': token } : undefined;
  const url = `${feed.apiBase}/projects/${feed.projectId}/releases?per_page=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    setState({
      status: 'error',
      error:
        res.status === 401 || res.status === 403
          ? '检查更新需要 GitLab 访问令牌（下方配置，scope=api）'
          : `获取最新版本失败（HTTP ${res.status}）`,
    });
    return null;
  }
  const list = (await res.json()) as Array<{ tag_name?: string }>;
  return list[0]?.tag_name ?? null;
}

/** 把 generic feed（含令牌头）注入 autoUpdater；每次检查前重指（tag 会变） */
async function applyFeed(): Promise<boolean> {
  const feed = brand.updaterFeed;
  if (!feed) return true; // 无 feed 的品牌走 electron-builder 默认（GitHub）
  const tag = await resolveGitLabTag();
  if (!tag) return false;
  const token = readUpdaterToken();
  // 指向 generic package 直连地址（不走 downloads API：那个 302 到包文件，
  // 重定向上自定义头的去留不受我们控制）
  const feedUrl = `${feed.apiBase}/projects/${feed.projectId}/packages/generic/fundet/${tag.replace(/^v/, '')}/`;
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  // electron-updater 6.8.9 的 setFeedURL 不消费 options.requestHeaders（只有
  // 构造函数读）；私有项目鉴权头必须直接赋公共字段，否则 latest.yml 拉取 404
  autoUpdater.requestHeaders = token ? { 'PRIVATE-TOKEN': token } : null;
  return true;
}

/** macOS 手动档：GitLab 查最新 tag 做版本比较（Web permalink 只认 cookie，走 API） */
async function checkMac(): Promise<void> {
  setState({ status: 'checking' });
  if (brand.updaterFeed && !(await applyFeed())) return;
  try {
    let latest = '';
    if (brand.updaterFeed) {
      const tag = await resolveGitLabTag();
      latest = (tag ?? '').replace(/^v/, '');
      if (!latest) return; // 错误态已在 resolveGitLabTag 里置
    } else {
      const res = await fetch(`${RELEASES_URL}/latest`, { method: 'HEAD', redirect: 'follow' });
      latest = (res.url.split('/').pop() ?? '').replace(/^v/, '');
    }
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
  if (!(await applyFeed())) return;
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

  // 更新令牌（私有 GitLab feed 用；空串 = 清除）。保存后立即试查一次（feed 会重指）
  ipcMain.handle(FUNDET_INVOKE.UPDATE_GET_TOKEN, () => readUpdaterToken() !== null);
  ipcMain.handle(FUNDET_INVOKE.UPDATE_SET_TOKEN, async (_e, token: string) => {
    const t = String(token ?? '').trim();
    if (t) writeProviderKey(UPDATER_TOKEN_KEY, t);
    else deleteProviderKey(UPDATER_TOKEN_KEY);
    if (app.isPackaged) void check();
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
