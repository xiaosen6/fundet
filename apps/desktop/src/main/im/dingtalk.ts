import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';

let client: DWClient | null = null;
let generation = 0;
const webhooks = new Map<string, string>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function replyWebhook(url: string, text: string): Promise<void> {
  for (const chunk of chunkImText(text)) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: chunk } }),
    });
  }
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
  client = dw;
  dw.registerCallbackListener(TOPIC_ROBOT, async (message: DWClientDownStream) => {
    try {
      if (gen !== generation) return;
      const raw = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
      const rec = asRecord(raw);
      if (!rec) return;
      const conversationId = String(rec.conversationId ?? '');
      const conversationType = String(rec.conversationType ?? '');
      const senderId = String(rec.senderStaffId || rec.senderId || '');
      const senderName = String(rec.senderNick || senderId.slice(-6) || '钉钉用户');
      const msgtype = String(rec.msgtype ?? rec.messageType ?? '');
      const textObj = asRecord(rec.text);
      const text = String(textObj?.content ?? rec.content ?? '').trim();
      const webhook = String(rec.sessionWebhook ?? '');
      if (webhook && conversationId) webhooks.set(conversationId, webhook);
      dw.socketCallBackResponse(message.headers?.messageId ?? '', { status: 'SUCCESS' });
      if (!conversationId || msgtype !== 'text' || !text) return;
      if (conversationType === '2') {
        const mentioned = Boolean(rec.isInAtList) || text.includes('@');
        if (!mentioned) return;
      }
      const replyText = await handleImMessage({
        channel: 'dingtalk',
        chatId: conversationId,
        senderName,
        text,
        dedupeKey: String(message.headers?.messageId ?? '') || undefined,
      });
      const hook = webhooks.get(conversationId);
      if (replyText && hook) await replyWebhook(hook, replyText);
    } catch (err) {
      console.warn('[fundet:im:dingtalk]', err);
    }
  });
  try {
    await dw.connect();
    if (gen === generation) setImRuntime('dingtalk', 'connected');
  } catch (err) {
    if (gen === generation) {
      setImRuntime('dingtalk', 'error', err instanceof Error ? err.message : String(err));
    }
  }
}

export async function stopDingTalk(): Promise<void> {
  generation += 1;
  try {
    client?.disconnect();
  } catch {
    /* ignore */
  }
  client = null;
  setImRuntime('dingtalk', 'idle');
}
