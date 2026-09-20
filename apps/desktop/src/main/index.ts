// 浏览器 runtime 的数据目录必须在 @fundet/browser-runtime 求值前种下（eager 常量），
// 所以这个副作用模块必须是 main 的第一条 import
import './browser/runtime-env.js';
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './db/client.js';
import { getHost, shutdownHost } from './host/pi-host.js';
import { resolvePiBinaryPath } from './host/pi-binary.js';
import { ensureBundledSkills } from './host/skills.js';
import { registerIpcHandlers } from './ipc/register.js';
import { registerImIpc, startSavedImBots, stopAllImBots } from './im/host.ts';
import { registerDwsIpc } from './host/dws.ts';
import { registerDwsWidgetsIpc, startDwsWidgets, stopDwsWidgets } from './host/dws-widgets.ts';
import { disposeBrowserHost } from './browser/host.js';
import { initUpdater } from './updater.js';
import {
  registerFileProtocolHandler,
  registerFileProtocolPrivileges,
} from './file-protocol.js';
import { brand } from '../shared/brand.js';

registerFileProtocolPrivileges();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 开发期 E2E 驱动：设 FUNDET_CDP_PORT 时打开 CDP 端口（tools/e2e-driver.mjs 用）
if (process.env['FUNDET_CDP_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['FUNDET_CDP_PORT']);
}

// Linux dev 兜底：WSL/无钥匙串环境下 safeStorage 不可用，chromium 的 basic
// password store（OSCrypt 固定密钥）能让 safeStorage 加解密工作起来。
// 仅开发态启用；打包版仍走系统钥匙串（libsecret/kwallet），不可用时 set-key 报错。
if (process.platform === 'linux' && !app.isPackaged) {
  app.commandLine.appendSwitch('password-store', 'basic');
}

// WSL/WSLg：同时有 WAYLAND_DISPLAY 和 DISPLAY 时 Electron 37 会走 Wayland，
// 任务栏只剩一个点不开的蓝点缩略图。强制 X11 + 软件渲染。
if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('disable-features', 'WaylandWindowDecorations');
}

function resolveAppIcon(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, file);
  }
  return path.join(__dirname, '../../resources', file);
}

function isWsl(): boolean {
  return Boolean(process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']);
}

/** 托盘「退出」/系统关机时置位，close 拦截据此放行真正退出 */
let isQuitting = false;
/** 首次最小化到托盘时弹一次气泡提示（仅 Windows 支持 displayBalloon） */
let trayHintShown = false;

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

/** 非 macOS：关窗 = 隐藏到托盘；托盘菜单「退出」或系统关机才真正退出。 */
function setupTrayAndCloseBehavior(win: BrowserWindow): void {
  let tray: Tray;
  try {
    tray = new Tray(resolveAppIcon());
  } catch (err) {
    // 无托盘环境（部分 Linux 桌面）：保持关窗即退出
    console.warn('[fundet] 托盘创建失败，关闭按钮保持直接退出', err);
    return;
  }
  tray.setToolTip(brand.name);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `打开 ${brand.name}`, click: () => focusMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => focusMainWindow());

  // Windows 注销/关机会销毁窗口，不能拦截（否则挡住系统关机）
  win.on('session-end', () => {
    isQuitting = true;
  });

  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true;
      tray.displayBalloon({
        title: brand.name,
        content: '已最小化到系统托盘，右键托盘图标可退出。',
      });
    }
  });
}

function revealWindow(win: BrowserWindow): void {
  win.setMinimumSize(960, 640);
  win.setBounds({ x: 80, y: 80, width: 1280, height: 800 });
  win.show();
  win.focus();
}

function createWindow(): void {
  const chrome =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 16 } }
      : process.platform === 'win32'
        ? { frame: false as const }
        : {};
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    x: 80,
    y: 80,
    show: true,
    title: brand.name,
    icon: resolveAppIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#2a2828' : '#f2ebe1',
    autoHideMenuBar: true,
    ...chrome,
    webPreferences: {
      // CJS（沙箱渲染进程加载不了 ESM preload），见 electron.vite.config.ts
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 只用 contextBridge/ipcRenderer/webUtils（沙箱均可用）；
      // 渲染层零 Node 面。
      sandbox: true,
      // Windows 遮挡检测有误判（窗口明明在前台却被当隐藏 → 渲染冻结，
      // 体感就是「点不动、过一会自己好」）。关掉节流保交互常活；
      // 流式输出也不允许被节流。副作用（隐藏时动画照跑）单窗口可接受。
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  // 链接不许顶替应用窗口：新窗口一律 deny，页面内跳转只放行应用自身页面
  // （dev server / 打包 file://），http(s) 交给系统浏览器。
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

  revealWindow(win);
  win.webContents.once('did-finish-load', () => revealWindow(win));
  if (process.platform !== 'darwin') setupTrayAndCloseBehavior(win);

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function bootstrap(): void {
  app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'clipboard-sanitized-write' || permission === 'clipboard-read';
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read');
  });
  // 1) 数据库（含 better-sqlite3 原生模块自查日志）
  initDatabase();
  // 1b) 安装包预制技能 → ~/.agents/skills（Pi 启动后即可 /skill: 点名）
  // Fundet 品牌不预装技能
  if (brand.bundledSkills) {
    try {
      ensureBundledSkills();
    } catch (err) {
      console.warn('[fundet:skills] 预制技能同步失败（不阻断启动）', err);
    }
  }
  // 2) pi 宿主装配（PiAgent + Maker 单例；二进制缺失会在这里抛错，早发现）
  try {
    getHost();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(`${brand.name} 启动失败`, message);
    app.quit();
    return;
  }
  // 2b) pi 运行时预检：bun 系二进制在无 AVX2 的 CPU 上启动即崩（0xC000001D），
  // 与其等用户第一次发消息报错，不如启动就讲清楚。正常机器这一步 <500ms。
  void (async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(resolvePiBinaryPath(), ['--version'], { stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code === 3221225501) {
        dialog.showErrorBox(
          '此电脑无法运行助手功能',
          '助手运行时（pi）需要 CPU 支持 AVX2 指令集，这台电脑的 CPU 不满足（2013 年前的 Intel、2015 年前的 AMD 或部分虚拟机的典型情况）。' +
          ` ${brand.name} 的其它功能可正常浏览，但无法新建对话。请换用支持 AVX2 的电脑。`,
        );
      }
    });
  })();

  // 3) IPC + 本地文件预览协议（视频 / 网页 / PDF）
  registerIpcHandlers();
  registerImIpc();
  registerDwsIpc();
  registerDwsWidgetsIpc();
  startDwsWidgets();
  registerFileProtocolHandler();
  void startSavedImBots();
  // 4) 应用更新（仅打包版启用，Windows 自动下载、macOS 手动引导）
  initUpdater();

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    void stopAllImBots();
    stopDwsWidgets();
    // 关闭托管浏览器（用过才发 stop；没用过 stop 反而会拉起服务挂住退出）
    void disposeBrowserHost();
    // 关闭所有活跃会话，回收 pi 子进程
    void shutdownHost();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// 关窗默认进托盘后，再点桌面图标/快捷方式会起到第二个实例（SQLite、pi 宿主会
// 冲突）。单实例锁：后起的实例直接退（app.quit 不拦截 ready 后的初始化，所以
// 整个 bootstrap 只在持锁实例里注册），由已有实例把隐藏窗口唤出来。
// userData 显式按品牌隔离（Electron 默认按 package.json name 取，Fundet 构建
// 会落到 fundet-desktop；且必须在 single-instance lock 之前设置才生效）。
// FUNDET_USER_DATA 环境变量可整体覆盖（冒烟/测试隔离用——Windows 上 Electron
// 的 appData 走系统 API 不吃 %APPDATA% 环境变量，锁隔离只能从这里做）。
const brandUserData = process.env.FUNDET_USER_DATA
  ? path.resolve(process.env.FUNDET_USER_DATA)
  : path.join(app.getPath('appData'), brand.name);
fs.mkdirSync(brandUserData, { recursive: true }); // 锁文件需要目录先存在，否则单实例锁失败 → 静默退出
app.setPath('userData', brandUserData);

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => focusMainWindow());
  bootstrap();
} else {
  app.quit();
}
