/**
 * PetHost —— 桌宠主进程宿主：窗口创建/销毁、状态桥、右键菜单、截图问答。
 *
 * 窗口：128×128 透明置顶，skipTaskbar，点击穿透（hover 恢复交互）。
 * 状态桥：sessionStore 的 agent 事件 → pet:state push。
 * 截图：desktopCapturer 全屏 → base64 → 主窗口 composer 注入。
 */
import { BrowserWindow, screen, ipcMain, Menu, desktopCapturer, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { brand } from '../../shared/brand.js';
import { FUNDET_INVOKE, FUNDET_PUSH } from '../ipc/channels.js';

export const PET_STATE = 'pet:state';
export const PET_NEW_CHAT = 'pet:new-chat';
export const PET_SCREENSHOT = 'pet:screenshot';
export const PET_READY = 'pet:ready';
export const PET_TOGGLE = 'pet:toggle';

let petWindow: BrowserWindow | null = null;

/** 桌宠窗口尺寸（比 128 素材大一圈，留漂浮与阴影余量） */
const PET_W = 148;
const PET_H = 168;

/** 窗口位置持久化（userData/pet-window.json） */
function petPosFile(): string {
  return path.join(app.getPath('userData'), 'pet-window.json');
}
function loadPetPos(): { x: number; y: number } | null {
  try {
    const raw = fs.readFileSync(petPosFile(), 'utf-8');
    const p = JSON.parse(raw) as { x: number; y: number };
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch { /* 首次运行无文件 */ }
  return null;
}
function savePetPos(x: number, y: number): void {
  try {
    fs.writeFileSync(petPosFile(), JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
  } catch { /* 写失败不致命 */ }
}

/** 帧资产目录（打包态 resources/pet/sprites，dev 态 renderer 目录） */
function spritesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'pet', 'sprites')
    : path.join(app.getAppPath(), 'src', 'renderer', 'pet', 'sprites');
}
void spritesPath; // pet.html 经 vite 打包后资产走 out/renderer；此函数留作将来直接引用 raw PNG 时的入口

export function isPetVisible(): boolean {
  return petWindow !== null && !petWindow.isDestroyed();
}

export function togglePet(show: boolean): void {
  if (show) {
    createPetWindow();
  } else {
    petWindow?.destroy();
    petWindow = null;
  }
}

export function createPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.focus();
    return;
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadPetPos();
  let x = screenW - PET_W - 22;
  let y = screenH - PET_H - 12;
  if (saved) {
    x = Math.max(0, Math.min(screenW - PET_W, saved.x));
    y = Math.max(0, Math.min(screenH - PET_H, saved.y));
  }

  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 点击穿透 + hover 恢复（渲染层 mousemove+elementFromPoint 判定后经 pet:hover 切换）
  petWindow.setIgnoreMouseEvents(true, { forward: true });

  petWindow.once('ready-to-show', () => {
    petWindow?.show();
  });

  petWindow.on('closed', () => { petWindow = null; });

  // 加载页面
  if (process.env['ELECTRON_RENDERER_URL']) {
    void petWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet.html`);
  } else {
    void petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  setupPetMenu();
}

/** 右键菜单 */
function setupPetMenu(): void {
  if (!petWindow) return;
  petWindow.webContents.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '截图问答', click: () => void petScreenshot() },
      { label: '新对话', click: () => void petNewChat() },
      { type: 'separator' },
      { label: `打开 ${brand.name}`, click: () => {
        const main = BrowserWindow.getAllWindows().find((w) => w !== petWindow);
        main?.show();
        main?.focus();
      }},
      { type: 'separator' },
      { label: '隐藏桌面助手', click: () => togglePet(false) },
    ]);
    menu.popup({ window: petWindow ?? undefined });
  });
}

/** 聚焦主窗口（桌宠外的那个窗口） */
function focusMainWindow(): void {
  const main = BrowserWindow.getAllWindows().find((w) => w !== petWindow);
  if (main) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
}

/** 双击 → 新对话（打开主窗口+通知渲染层新建会话） */
async function petNewChat(): Promise<void> {
  const main = BrowserWindow.getAllWindows().find((w) => w !== petWindow);
  if (main) {
    main.show();
    main.focus();
    main.webContents.send(PET_NEW_CHAT, {});
  }
}

/** 截图问答：全屏截图 → 注入主窗口 composer */
async function petScreenshot(): Promise<void> {
  try {
    // 隐藏桌宠避免截到它自己
    petWindow?.hide();

    // 等一帧让桌宠消失
    await new Promise((r) => setTimeout(r, 150));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    const primary = sources[0];
    if (!primary) throw new Error('无法获取屏幕画面');

    const dataUrl = primary.thumbnail.toDataURL();
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('截图数据为空');

    // 恢复桌宠
    petWindow?.show();

    // 打开主窗口并注入截图
    const main = BrowserWindow.getAllWindows().find((w) => w !== petWindow);
    if (main) {
      main.show();
      main.focus();
      main.webContents.send('pet:screenshot-result', { base64 });
    }
  } catch (err) {
    petWindow?.show();
    console.error('[fundet:pet] 截图失败:', err instanceof Error ? err.message : String(err));
  }
}

/** 推送状态到桌宠窗口 */
export function pushPetState(state: string): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send(PET_STATE, state);
  }
}

/** 注册桌宠 IPC */
export function registerPetIpc(getPetEnabled: () => boolean): void {
  ipcMain.on(PET_READY, () => {
    pushPetState('idle');
  });
  ipcMain.on(PET_NEW_CHAT, () => void petNewChat());
  ipcMain.on(PET_SCREENSHOT, () => void petScreenshot());
  // hover → 穿透切换
  ipcMain.on('pet:hover', (_e, isHover: boolean) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.setIgnoreMouseEvents(!isHover, { forward: true });
  });
  // 拖拽：渲染层上报鼠标位移，主进程平移窗口（clamp 在工作区内）
  ipcMain.on('pet:drag', (_e, dx: number, dy: number) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const [wx, wy] = petWindow.getPosition();
    const nx = Math.max(-PET_W / 2, Math.min(sw - PET_W / 2, wx + dx));
    const ny = Math.max(0, Math.min(sh - PET_H / 2, wy + dy));
    petWindow.setPosition(Math.round(nx), Math.round(ny));
  });
  // 拖拽结束：贴边吸附 + 持久化窗口位置
  ipcMain.on('pet:drag-end', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    const [wx, wy] = petWindow.getPosition();
    const nx = wx + PET_W / 2 < sw / 2 ? 8 : sw - PET_W - 8;
    petWindow.setPosition(nx, wy);
    savePetPos(nx, wy);
  });
  // 单击 → 聚焦主窗口
  ipcMain.on('pet:focus-main', () => focusMainWindow());
  ipcMain.handle(PET_TOGGLE, (_e, show: boolean) => {
    togglePet(show);
    return { ok: true };
  });
  ipcMain.handle('pet:visible', () => isPetVisible());
}
