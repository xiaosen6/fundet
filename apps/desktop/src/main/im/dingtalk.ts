/**
 * 钉钉机器人（完整版，机制照 Cindy lizi-im dingtalk 手工移植）：
 * - 长连收消息（dingtalk-stream TOPIC_ROBOT）→ 纯函数解析（dingtalk-inbound）
 * - 文本 + 图片入站：图片走 downloadCode → API 下载 → 落工作目录 → 作为图片块发给模型
 * - 出站：文本分块（webhook 优先/robot 兜底）+ 回复里的本地图片上传后单独发图
 * - 会话目标（单聊/群 + webhook 过期）按会话缓存
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import { chunkImText, handleImMessage, type ImInbound, type ImInboundExtras } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';
import {
  DingTalkApiClient,
  type DingTalkOutboundTarget,
} from './dingtalk-api.ts';
import { parseInboundContent, parseInboundEnvelope } from './dingtalk-inbound.ts';

const requireElectron = createRequire(import.meta.url);

let client: DWClient | null = null;
let api: DingTalkApiClient | null = null;
let generation = 0;
/** conversationId → 发送目标（webhook + 过期时间 + 单/群身份） */
const targets = new Map<string, DingTalkOutboundTarget>();

function targetOf(conversationId: string): DingTalkOutboundTarget | null {
  return targets.get(conversationId) ?? null;
}

async function sendText(conversationId: string, text: string): Promise<void> {
  const target = targetOf(conversationId);
  if (!target) throw new Error('没有可用的回复通道（会话 webhook 未建立）');
  if (!api) throw new Error('钉钉 API 客户端未初始化');
  for (const chunk of chunkImText(text)) {
    await api.sendText(target, chunk);
  }
}

/** per-bot 工作目录（Cindy dingtalkManagedWorkingDirName 同款隔离语义） */
export function dingtalkWorkDir(appKey: string): string {
  const { app } = requireElectron('electron') as typeof import('electron');
  const base = path.join(app.getPath('userData'), 'im-workspace');
  const safe = /^[A-Za-z0-9_-]{1,128}$/.test(appKey)
    ? appKey
    : `ext-${appKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)}`;
  const dir = path.join(base, `dingtalk-${safe}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 回复里的本地图片 markdown 引用 → 上传发图；返回剥掉已发引用的文本 */
async function sendLocalImages(
  conversationId: string,
  workDir: string,
  finalText: string,
): Promise<{ text: string; sentAny: boolean }> {
  if (!api) return { text: finalText, sentAny: false };
  const refs = [...finalText.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
  const locals: Array<{ ref: string; abs: string }> = [];
  for (const ref of refs.slice(0, 5)) {
    if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) continue;
    const abs = path.isAbsolute(ref) ? ref : path.resolve(workDir, ref);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size <= 20 * 1024 * 1024) {
        locals.push({ ref, abs });
      }
    } catch {
      /* stat 失败跳过 */
    }
  }
  if (locals.length === 0) return { text: finalText, sentAny: false };
  const target = targetOf(conversationId);
  if (!target) return { text: finalText, sentAny: false };
  let stripped = finalText;
  let sentAny = false;
  for (const { ref, abs } of locals) {
    try {
      const bytes = new Uint8Array(fs.readFileSync(abs));
      await api.sendImage(target, bytes, path.basename(abs));
      sentAny = true;
      stripped = stripped.split(`(${ref})`).join('()');
    } catch (err) {
      console.warn('[fundet:im:dingtalk] 图片发送失败（跳过该图）', err);
    }
  }
  return { text: stripped, sentAny };
}

export async function startDingTalk(): Promise<void> {
  const creds = readImCreds('dingtalk');
  const clientId = creds?.appKey?.trim() ?? '';
  const clientSecret = creds?.appSecret?.trim() ?? '';
  if (!clientId || !clientSecret) {
    setImRuntime('dingtalk', 'idle');
    return;
  }
  await stopDingTalk();
  const gen = ++generation;
  setImRuntime('dingtalk', 'connecting');
  const dw = new DWClient({ clientId, clientSecret });
  const apiClient = new DingTalkApiClient(clientId, clientSecret);
  client = dw;
  api = apiClient;
  const workDir = dingtalkWorkDir(clientId);

  dw.registerCallbackListener(TOPIC_ROBOT, async (message: DWClientDownStream) => {
    try {
      if (gen !== generation) return;
      const raw = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
      const envelope = parseInboundEnvelope(raw);
      if (!envelope) return;
      targets.set(envelope.conversationId, {
        kind: envelope.conversationType === '2' ? 'group' : 'direct',
        id: envelope.conversationType === '2' ? envelope.conversationId : envelope.senderId,
        sessionWebhook: envelope.sessionWebhook,
        sessionWebhookExpiresAt: envelope.sessionWebhookExpiresAt,
      });
      dw.socketCallBackResponse(message.headers?.messageId ?? '', { status: 'SUCCESS' });
      const content = parseInboundContent(envelope);
      // 群聊必须 @（单聊 mentioned 恒真）
      if (envelope.conversationType === '2' && !envelope.mentioned) return;
      if (content.unsupported.length > 0 && !content.text && content.downloadCodes.length === 0) {
        await sendText(envelope.conversationId, `暂不支持${content.unsupported[0]!.label}消息。`);
        return;
      }
      if (!content.text && content.downloadCodes.length === 0) return;

      const extras: ImInboundExtras = {
        workDir,
        downloadImages:
          content.downloadCodes.length > 0
            ? async () => {
                const out: Array<{ buffer: Uint8Array; mimeType: string }> = [];
                for (const code of content.downloadCodes) {
                  out.push(await apiClient.downloadImage(code));
                }
                return out;
              }
            : undefined,
        reply: (text) => sendText(envelope.conversationId, text),
      };
      const resultText = await handleImMessage(
        {
          channel: 'dingtalk',
          chatId: envelope.conversationId,
          senderName: envelope.senderName,
          text: content.text,
          dedupeKey: envelope.messageId || undefined,
        },
        extras,
      );
      if (resultText) {
        const { text: stripped, sentAny } = await sendLocalImages(envelope.conversationId, workDir, resultText);
        const cleaned = stripped.replace(/!\[[^\]]*\]\(\)/g, '').trim();
        if (cleaned) await sendText(envelope.conversationId, cleaned);
        else if (!sentAny) await sendText(envelope.conversationId, resultText);
      }
    } catch (err) {
      console.warn('[fundet:im:dingtalk] 消息处理失败', err);
    }
  });
  try {
    await dw.connect();
    if (gen !== generation) return;
    setImRuntime('dingtalk', 'connected');
  } catch (err) {
    if (gen === generation) {
      setImRuntime('dingtalk', 'error', err instanceof Error ? err.message : String(err));
      await stopDingTalk();
    }
  }
}

export async function stopDingTalk(): Promise<void> {
  generation += 1;
  targets.clear();
  api?.close();
  api = null;
  try {
    client?.disconnect();
  } catch {
    /* ignore */
  }
  client = null;
  setImRuntime('dingtalk', 'idle');
}
