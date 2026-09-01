import { BrowserWindow } from 'electron';
import type { ImChannelId, ImChannelStatus, ImConnKind } from '../../shared/im-bots.ts';
import { IM_CHANNELS } from '../../shared/im-bots.ts';
import { FUNDET_PUSH } from '../ipc/channels.js';
import { getSetting } from '../db/settings.js';
import { hasImCreds } from './secrets.ts';

const kinds = new Map<ImChannelId, ImConnKind>();
const details = new Map<ImChannelId, string>();
const qrUrls = new Map<ImChannelId, string>();

export function setImRuntime(
  id: ImChannelId,
  kind: ImConnKind,
  detail?: string,
  qrUrl?: string | null,
): void {
  kinds.set(id, kind);
  if (detail) details.set(id, detail);
  else details.delete(id);
  if (qrUrl) qrUrls.set(id, qrUrl);
  else if (qrUrl === null) qrUrls.delete(id);
  broadcastImStatus();
}

export function imKind(id: ImChannelId): ImConnKind {
  return kinds.get(id) ?? 'idle';
}

function broadcastImStatus(): void {
  const payload = snapshotImStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(FUNDET_PUSH.IM_STATUS_CHANGED, payload);
  }
}

export function snapshotImStatus(): { channels: ImChannelStatus[]; workDir: string; providerId: string; model: string } {
  return {
    channels: IM_CHANNELS.map((meta) => ({
      id: meta.id,
      name: meta.name,
      hint: meta.hint,
      signupUrl: meta.signupUrl,
      fields: meta.fields,
      qr: meta.qr,
      configured: hasImCreds(meta.id) || imKind(meta.id) === 'connecting' || imKind(meta.id) === 'connected',
      kind: imKind(meta.id),
      ...(details.get(meta.id) ? { detail: details.get(meta.id) } : {}),
      ...(qrUrls.get(meta.id) ? { qrUrl: qrUrls.get(meta.id) } : {}),
    })),
    workDir: getSetting('im.workDir') ?? '',
    providerId: getSetting('im.providerId') ?? '',
    model: getSetting('im.model') ?? '',
  };
}

export function broadcastSessionListChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(FUNDET_PUSH.SESSION_LIST_CHANGED, {});
  }
}
