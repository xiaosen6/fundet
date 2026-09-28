/**
 * PetHost —— 桌宠主进程宿主：窗口创建/销毁、状态桥、截图问答。
 *
 * 窗口：128×128 透明置顶，skipTaskbar，点击穿透（hover 恢复交互）。
 * 状态桥：sessionStore 的 agent 事件 → pet:state push。
 * 截图：desktopCapturer 全屏 → base64 → 主窗口 composer 注入。
 */
import { BrowserWindow, screen, ipcMain, desktopCapturer, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { FUNDET_INVOKE, FUNDET_PUSH } from '../ipc/channels.js';
import { setBoolSetting } from '../db/settings.js';

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
}

/** 单击 → 新对话（打开主窗口+通知渲染层新建会话） */
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
  // 拖拽：主进程本地轮询光标平移窗口（不经渲染层 IPC，拖动更跟手）
  let dragTimer: ReturnType<typeof setInterval> | null = null;
  let dragGrabX = 0;
  let dragGrabY = 0;
  const stopDrag = (): void => {
    if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  };
  ipcMain.on('pet:drag-start', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = petWindow.getPosition();
    dragGrabX = p.x - wx;
    dragGrabY = p.y - wy;
    stopDrag();
    dragTimer = setInterval(() => {
      if (!petWindow || petWindow.isDestroyed()) { stopDrag(); return; }
      const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
      const c = screen.getCursorScreenPoint();
      const nx = Math.max(-PET_W / 2, Math.min(sw - PET_W / 2, c.x - dragGrabX));
      const ny = Math.max(0, Math.min(sh - PET_H / 2, c.y - dragGrabY));
      petWindow.setPosition(Math.round(nx), Math.round(ny));
    }, 16);
  });
  // 拖拽结束：记录位置（不自动贴边）
  ipcMain.on('pet:drag-end', () => {
    stopDrag();
    if (!petWindow || petWindow.isDestroyed()) return;
    const [wx, wy] = petWindow.getPosition();
    savePetPos(wx, wy);
  });
  ipcMain.handle(PET_TOGGLE, (_e, show: boolean) => {
    setBoolSetting('pet.enabled', show);
    togglePet(show);
    return { ok: true };
  });
  ipcMain.handle('pet:visible', () => isPetVisible());
}
