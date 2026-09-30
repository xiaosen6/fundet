/**
 * 完成提醒：agent turn 终态（done / 终止 error——统一口径不区分）且主窗
 * 失焦/隐藏/最小化时，发系统通知（静音）+ 应用内提示音（主窗渲染层 WebAudio，
 * 3s 节流防并发完成连响）。点击通知 = 聚焦主窗并切到该会话。
 * 开关存 settings `pet.notify`（用户口径「桌宠提醒」，放桌宠设置区），默认开。
 * 注视判定见 completion-notify-logic.ts（最小化的窗口即使 isFocused 仍 true 也不算注视）。
 */
import { BrowserWindow, Notification } from 'electron';
import { brand } from '../../shared/brand.ts';
import { getBoolSetting } from '../db/settings.js';
import { FUNDET_PUSH } from '../ipc/channels.js';
import { isWindowWatching, shouldNotifyCompletion } from './completion-notify-logic.js';

export const COMPLETION_NOTIFY_SETTING = 'pet.notify';
const CHIME_THROTTLE_MS = 3000;
let lastChimeAt = 0;

function mainWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().endsWith('pet.html'));
  return win ?? null;
}

export function notifyTurnFinished(sessionId: string, title: string, summary: string): void {
  const main = mainWindow();
  const focused = isWindowWatching(main);
  if (!shouldNotifyCompletion({ enabled: getBoolSetting(COMPLETION_NOTIFY_SETTING, true), mainWindowFocused: focused })) {
    return;
  }

  const now = Date.now();
  if (now - lastChimeAt > CHIME_THROTTLE_MS) {
    lastChimeAt = now;
    main?.webContents.send(FUNDET_PUSH.NOTIFY_CHIME, {});
  }

  if (!Notification.isSupported()) return;
  const body = [title, summary].filter((s) => s && s.length > 0).join('\n');
  const notification = new Notification({
    title: `${brand.name}：工作已完成`,
    body: body.slice(0, 120),
    // 系统通知自带音效关掉——声音统一走应用内 chime，受应用开关控制、不双响
    silent: true,
  });
  notification.on('click', () => {
    const win = mainWindow();
    if (!win) return;
    win.show();
    win.focus();
    win.webContents.send(FUNDET_PUSH.NOTIFY_OPEN_SESSION, { sessionId });
  });
  notification.show();
}
