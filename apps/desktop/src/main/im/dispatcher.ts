/**
 * IM 入站 → Fundet Pi 会话 → 把助手最终文本回给渠道。
 * 每个 (channel, chatId) 一条会话，排队避免并发回合。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ImChannelId } from '../../shared/im-bots.ts';
import { getSetting, setSetting } from '../db/settings.js';
import { listProviders } from '../db/providers.js';
import { hasProviderKey } from '../host/secrets.js';
import { getHost } from '../host/pi-host.js';
import { insertMessage } from '../db/messages.js';
import { wireSession } from '../ipc/register.js';
import { getDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { broadcastSessionListChanged } from './runtime.ts';
import { collectFinalText } from './turn-collector.ts';
import { createInboundDedup } from './dedup.ts';
import { brand } from '../../shared/brand.ts';

const CHANNEL_LABEL: Record<ImChannelId, string> = {
  wechat: '微信',
  wecom: '企微',
  feishu: '飞书',
  dingtalk: '钉钉',
};

export interface ImInbound {
  channel: ImChannelId;
  chatId: string;
  senderName: string;
  text: string;
  /** 渠道侧的稳定消息 id（message_id / msgid / messageId）；长连重连重推时靠它去重 */
  dedupeKey?: string;
}

const queues = new Map<string, Promise<string>>();

function mapKey(channel: ImChannelId, chatId: string): string {
  return `${channel}:${chatId}`;
}

function sessionMapKey(channel: ImChannelId, chatId: string): string {
  return `im.session.${channel}.${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function resolveWorkDir(): string {
  const saved = getSetting('im.workDir')?.trim();
  if (saved) {
    fs.mkdirSync(saved, { recursive: true });
    return saved;
  }
  const dir = path.join(app.getPath('userData'), 'im-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveModel(): { providerId: string; model: string } {
  const providers = listProviders();
  const savedPid = getSetting('im.providerId') ?? '';
  const savedModel = getSetting('im.model') ?? '';
  const preferred = providers.find((p) => p.id === savedPid) ?? providers.find((p) => hasProviderKey(p.id));
  if (!preferred) throw new Error('还没有配置模型供应商。请先在设置 → 模型供应商填 API key。');
  const model =
    preferred.models.find((m) => m.id === savedModel)?.id ??
    preferred.models.find((m) => m.enabled !== false)?.id ??
    preferred.models[0]?.id;
  if (!model) throw new Error('该供应商还没有模型。');
  return { providerId: preferred.id, model };
}

async function runTurn(msg: ImInbound): Promise<string> {
  const text = msg.text.trim();
  if (!text) return '';
  const { maker } = getHost();
  const key = sessionMapKey(msg.channel, msg.chatId);
  let sessionId = getSetting(key);
  let session = sessionId ? maker.getSession(sessionId) : null;
  if (!session) {
    const { providerId, model } = resolveModel();
    const workDir = resolveWorkDir();
    console.log('[fundet:im] 建会话', { channel: msg.channel, model, workDir });
    const existing = sessionId
      ? getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).get()
      : null;
    session = await maker.createSession({
      agentKind: 'pi',
      id: existing?.id ?? randomUUID(),
      title: `${CHANNEL_LABEL[msg.channel]} · ${msg.senderName || msg.chatId.slice(-6)}`,
      workingDir: workDir,
      model,
      providerId,
      permissionMode: 'auto',
    });
    wireSession(session);
    setSetting(key, session.id);
    broadcastSessionListChanged();
  } else {
    wireSession(session);
  }
  insertMessage(session.id, 'user', { text, source: msg.channel });
  const collector = collectFinalText(session);
  const sent = await session.send(text);
  if (!sent.accepted) {
    collector.dispose();
    console.warn('[fundet:im] 会话拒收', { sessionId: session.id, reason: sent.reason });
    return `没发出去：${sent.reason ?? '未知原因'}`;
  }
  return collector.promise;
}

/** 长连重连重推去重窗口（按渠道消息 id） */
const inboundDedup = createInboundDedup();

export function handleImMessage(msg: ImInbound): Promise<string> {
  if (msg.dedupeKey && inboundDedup.seen(msg.dedupeKey)) {
    console.warn('[fundet:im] 丢弃重推的重复消息', { channel: msg.channel, key: msg.dedupeKey });
    return Promise.resolve('');
  }
  const key = mapKey(msg.channel, msg.chatId);
  const prev = queues.get(key) ?? Promise.resolve('');
  const next = prev
    .catch(() => '')
    .then(() => runTurn(msg))
    .catch((err) => ` ${brand.name} 出错：${err instanceof Error ? err.message : String(err)}`);
  queues.set(key, next);
  return next;
}

export function chunkImText(text: string, size = 3500): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
  return out;
}

export function defaultImWorkDirHint(): string {
  return path.join(app.getPath('home') || os.homedir(), `${brand.name}-IM`);
}
