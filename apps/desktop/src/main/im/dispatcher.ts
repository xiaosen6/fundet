/**
 * IM 入站 → Fundet Pi 会话 → 把助手最终文本回给渠道。
 * 每个 (channel, chatId) 一条会话，排队避免并发回合。
 *
 * 2026-09-18 钉钉完整版配套（照 Cindy 移植）：
 * - 入站附件（图片）：channel 下载后经 extras 注入，落工作目录 .fundet-uploads/
 *   再以 image 块发给模型（复用 §4.3 的 stage 语义）；
 * - 审批问答桥：IM 会话改 ask 档，交互请求转成渠道文本问答（im-interaction），
 *   挂起等待该聊天的下一条消息（回复旁路——不排队，否则死锁）；
 * - extras.workDir：渠道指定会话工作目录（钉钉 per-bot 隔离），优先于全局设置。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  InteractionDecision,
  InteractionRequest,
  Session,
  UserContentBlock,
} from '@fundet/agent-core';
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
import {
  formatInteractionPrompt,
  formatQuestionPrompt,
  parseInteractionReply,
  parseQuestionAnswer,
} from './im-interaction.ts';

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

/** 渠道侧注入的附加能力（图片下载 / 回复通道 / 会话工作目录） */
export interface ImInboundExtras {
  /** 该聊天会话使用的固定工作目录（per-bot 隔离；省略用全局设置） */
  workDir?: string;
  /** 图片字节下载器（channel 已从平台拿到 downloadCode 等） */
  downloadImages?: () => Promise<Array<{ buffer: Uint8Array; mimeType: string }>>;
  /** 该聊天的直接文本回复通道（审批提问用；与回合结束的最终回复独立） */
  reply?: (text: string) => Promise<void>;
}

const queues = new Map<string, Promise<string>>();

function mapKey(channel: ImChannelId, chatId: string): string {
  return `${channel}:${chatId}`;
}

function sessionMapKey(channel: ImChannelId, chatId: string): string {
  return `im.session.${channel}.${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function resolveWorkDir(extras?: ImInboundExtras): string {
  if (extras?.workDir) {
    fs.mkdirSync(extras.workDir, { recursive: true });
    return extras.workDir;
  }
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

// ---------------------------------------------------------------------------
// 审批问答桥：挂起等该聊天的下一条文本消息（回复旁路，不走回合队列）
// ---------------------------------------------------------------------------

interface PendingReply {
  resolve: (text: string) => void;
  timer: NodeJS.Timeout;
}
const pendingReplies = new Map<string, PendingReply>();
/** 审批等待上限：须小于回合兜底超时（10min），到点 deny 放行队列 */
const IM_INTERACTION_TIMEOUT_MS = 9 * 60_000;

function awaitImReply(
  channel: ImChannelId,
  chatId: string,
  promptText: string,
  extras: ImInboundExtras | undefined,
): Promise<string> {
  return new Promise((resolve) => {
    const key = mapKey(channel, chatId);
    const prev = pendingReplies.get(key);
    prev?.resolve('');
    const timer = setTimeout(() => {
      pendingReplies.delete(key);
      resolve('');
    }, IM_INTERACTION_TIMEOUT_MS);
    pendingReplies.set(key, { resolve, timer });
    const send = extras?.reply;
    if (send) {
      void send(promptText).catch((err) => {
        console.warn('[fundet:im] 审批提问发送失败', err);
      });
    }
  });
}

/** IM 会话的交互监听：覆盖 wireSession 的 UI 广播（IM = 渠道确认面，Cindy confirmationSurface='channel'） */
function attachImInteractionBridge(
  session: Session,
  channel: ImChannelId,
  chatId: string,
  extras: ImInboundExtras | undefined,
): void {
  session.setInteractionListener(async (request: InteractionRequest): Promise<InteractionDecision> => {
    const denyOf = (reason: string): InteractionDecision =>
      request.kind === 'permission'
        ? { kind: 'permission', behavior: 'deny', reason }
        : request.kind === 'plan_review'
          ? { kind: 'plan_review', behavior: 'deny', reason }
          : { kind: 'permission', behavior: 'deny', reason };

    if (request.kind === 'ask_user_question') {
      const answers: Record<string, string> = {};
      for (const [index, question] of request.questions.entries()) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const text = await awaitImReply(
            channel,
            chatId,
            formatQuestionPrompt(question, index, request.questions.length),
            extras,
          );
          const answer = parseQuestionAnswer(question, text);
          if (answer !== null) {
            answers[question.question] = answer;
            break;
          }
          if (!text) {
            // 超时/空答：未答的题按空串提交（agent-core 自行兜底）
            answers[question.question] = '';
            break;
          }
        }
      }
      return { kind: 'ask_user_question', answers };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await awaitImReply(channel, chatId, formatInteractionPrompt(request), extras);
      const decision = text ? parseInteractionReply(request, text) : null;
      if (decision) return decision;
      if (!text) return denyOf('im_interaction_timeout');
    }
    return denyOf('im_user_no_valid_reply');
  });
}

// ---------------------------------------------------------------------------
// 回合执行
// ---------------------------------------------------------------------------

function extensionOfMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

/** 图片字节 → 工作目录 .fundet-uploads/ 落盘，返回绝对路径（stage 语义同 §4.3） */
function stageImages(
  workDir: string,
  images: Array<{ buffer: Uint8Array; mimeType: string }>,
): string[] {
  const dir = path.join(workDir, '.fundet-uploads');
  fs.mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const [i, img] of images.entries()) {
    const file = path.join(dir, `im-${Date.now()}-${i}.${extensionOfMime(img.mimeType)}`);
    fs.writeFileSync(file, img.buffer);
    paths.push(file);
  }
  return paths;
}

async function runTurn(msg: ImInbound, extras?: ImInboundExtras): Promise<string> {
  const text = msg.text.trim();
  const imagePaths: string[] = [];
  if (extras?.downloadImages) {
    try {
      const images = await extras.downloadImages();
      if (images.length > 0) {
        const workDir0 = resolveWorkDir(extras);
        imagePaths.push(...stageImages(workDir0, images));
      }
    } catch (err) {
      const warn = `图片下载失败：${err instanceof Error ? err.message : String(err)}`;
      if (text) await extras.reply?.(`（${warn}，仅处理文字）`).catch(() => undefined);
      else return warn;
    }
  }
  if (!text && imagePaths.length === 0) return '';

  const { maker } = getHost();
  const key = sessionMapKey(msg.channel, msg.chatId);
  let sessionId = getSetting(key);
  let session = sessionId ? maker.getSession(sessionId) : null;
  if (!session) {
    const { providerId, model } = resolveModel();
    const workDir = resolveWorkDir(extras);
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
      // ask 档 + 渠道问答桥（Cindy permissionPolicy 语义）；有桥兜底，不会卡死
      permissionMode: 'ask',
    });
    wireSession(session);
    setSetting(key, session.id);
    broadcastSessionListChanged();
  } else {
    wireSession(session);
  }
  // 覆盖 UI 交互监听：IM 会话的审批走渠道问答，不进桌面 UI
  attachImInteractionBridge(session, msg.channel, msg.chatId, extras);

  insertMessage(session.id, 'user', {
    text: text || '（图片）',
    source: msg.channel,
    ...(imagePaths.length > 0 ? { images: imagePaths } : {}),
  });
  const collector = collectFinalText(session);
  const content: string | UserContentBlock[] =
    imagePaths.length === 0
      ? text
      : [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...imagePaths.map((p) => ({ type: 'image' as const, path: p })),
        ];
  const sent = await session.send({ type: 'user', content });
  if (!sent.accepted) {
    collector.dispose();
    console.warn('[fundet:im] 会话拒收', { sessionId: session.id, reason: sent.reason });
    return `没发出去：${sent.reason ?? '未知原因'}`;
  }
  return collector.promise;
}

/** 长连重连重推去重窗口（按渠道消息 id） */
const inboundDedup = createInboundDedup();

export function handleImMessage(msg: ImInbound, extras?: ImInboundExtras): Promise<string> {
  if (msg.dedupeKey && inboundDedup.seen(msg.dedupeKey)) {
    console.warn('[fundet:im] 丢弃重推的重复消息', { channel: msg.channel, key: msg.dedupeKey });
    return Promise.resolve('');
  }
  // 审批回复旁路：挂起中的交互等待直接吃掉这条消息（不走回合队列——
  // 队列正被等审批的回合占着，排队会死锁）
  const pending = pendingReplies.get(mapKey(msg.channel, msg.chatId));
  if (pending && msg.text.trim()) {
    pendingReplies.delete(mapKey(msg.channel, msg.chatId));
    clearTimeout(pending.timer);
    pending.resolve(msg.text.trim());
    return Promise.resolve('');
  }
  const key = mapKey(msg.channel, msg.chatId);
  const prev = queues.get(key) ?? Promise.resolve('');
  const next = prev
    .catch(() => '')
    .then(() => runTurn(msg, extras))
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
