import { ipcMain } from 'electron';
import os from 'node:os';
import { FUNDET_INVOKE } from '../ipc/channels.js';
import { getSetting, setSetting } from '../db/settings.js';
import { isImChannelId, type ImChannelId, type ImSaveInput } from '../../shared/im-bots.ts';
import { clearImCreds, hasImCreds, writeImCreds } from './secrets.ts';
import { snapshotImStatus } from './runtime.ts';
import { startFeishu, stopFeishu } from './feishu.ts';
import { startDingTalk, stopDingTalk } from './dingtalk.ts';
import { startWecom, stopWecom } from './wecom.ts';
import { cancelWechatQr, clearWechat, startWechat, startWechatQr, stopWechat } from './wechat.ts';

async function startChannel(id: ImChannelId): Promise<void> {
  if (id === 'feishu') return startFeishu();
  if (id === 'dingtalk') return startDingTalk();
  if (id === 'wecom') return startWecom();
  return startWechat();
}

async function stopChannel(id: ImChannelId): Promise<void> {
  if (id === 'feishu') return stopFeishu();
  if (id === 'dingtalk') return stopDingTalk();
  if (id === 'wecom') return stopWecom();
  return stopWechat();
}

export async function startSavedImBots(): Promise<void> {
  const ids: ImChannelId[] = ['feishu', 'dingtalk', 'wecom', 'wechat'];
  for (const id of ids) {
    if (!hasImCreds(id)) continue;
    try {
      console.log(`[fundet:im] 检测到已保存凭证，自动连接 ${id}`);
      await startChannel(id);
    } catch (err) {
      console.warn(`[fundet:im] ${id} 自动连接失败`, err);
    }
  }
}

export async function stopAllImBots(): Promise<void> {
  await Promise.allSettled([stopFeishu(), stopDingTalk(), stopWecom(), stopWechat()]);
}

export function registerImIpc(): void {
  ipcMain.handle(FUNDET_INVOKE.IM_STATUS, async () => snapshotImStatus());

  ipcMain.handle(FUNDET_INVOKE.IM_SAVE, async (_e, input: ImSaveInput) => {
    if (!isImChannelId(input.id)) throw new Error('未知渠道');
    if (input.id === 'wechat') throw new Error('微信请用扫码连接');
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.fields ?? {})) {
      if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
    }
    if (Object.keys(fields).length < 2) throw new Error('请填完整凭证');
    writeImCreds(input.id, fields);
    await startChannel(input.id);
  });

  ipcMain.handle(FUNDET_INVOKE.IM_CLEAR, async (_e, id: string) => {
    if (!isImChannelId(id)) throw new Error('未知渠道');
    await stopChannel(id);
    if (id === 'wechat') await clearWechat();
    else clearImCreds(id);
  });

  ipcMain.handle(FUNDET_INVOKE.IM_CONNECT, async (_e, id: string) => {
    if (!isImChannelId(id)) throw new Error('未知渠道');
    await startChannel(id);
  });

  ipcMain.handle(FUNDET_INVOKE.IM_DISCONNECT, async (_e, id: string) => {
    if (!isImChannelId(id)) throw new Error('未知渠道');
    await stopChannel(id);
  });

  ipcMain.handle(FUNDET_INVOKE.IM_WECHAT_QR_START, async () => startWechatQr());
  ipcMain.handle(FUNDET_INVOKE.IM_WECHAT_QR_CANCEL, async () => {
    cancelWechatQr();
  });

  ipcMain.handle(FUNDET_INVOKE.IM_SET_DEFAULTS, async (_e, patch: { workDir?: string; providerId?: string; model?: string }) => {
    if (typeof patch.workDir === 'string') setSetting('im.workDir', patch.workDir);
    if (typeof patch.providerId === 'string') setSetting('im.providerId', patch.providerId);
    if (typeof patch.model === 'string') setSetting('im.model', patch.model);
  });
}

export function imHomeDir(): string {
  return getSetting('im.workDir') || os.homedir();
}
