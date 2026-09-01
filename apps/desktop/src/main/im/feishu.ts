import * as Lark from '@larksuiteoapi/node-sdk';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';

let ws: Lark.WSClient | null = null;
let rest: Lark.Client | null = null;
let generation = 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nested(rec: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = rec;
  for (const k of keys) {
    const obj = asRecord(cur);
    if (!obj) return undefined;
    cur = obj[k];
  }
  return cur;
}

async function reply(chatId: string, text: string): Promise<void> {
  if (!rest) return;
  for (const chunk of chunkImText(text)) {
    await rest.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: chunk }),
      },
    });
  }
}

export async function startFeishu(): Promise<void> {
  const creds = readImCreds('feishu');
  const appId = creds?.appId?.trim() ?? '';
  const appSecret = creds?.appSecret?.trim() ?? '';
  if (!appId || !appSecret) {
    setImRuntime('feishu', 'idle');
    return;
  }
  await stopFeishu();
  const gen = ++generation;
  setImRuntime('feishu', 'connecting');
  rest = new Lark.Client({ appId, appSecret, appType: Lark.AppType.SelfBuild });
  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: unknown) => {
      if (gen !== generation) return;
      const rec = asRecord(data) ?? {};
      const event = asRecord(rec.event) ?? rec;
      const message = asRecord(event.message);
      const sender = asRecord(event.sender);
      if (!message) return;
      const chatId = String(message.chat_id ?? '');
      const chatType = String(message.chat_type ?? '');
      const msgType = String(message.message_type ?? '');
      if (!chatId) return;
      if (String(message.sender_type ?? sender?.sender_type ?? '') === 'app') return;
      let text = '';
      try {
        const content = JSON.parse(String(message.content ?? '{}')) as { text?: string };
        text = typeof content.text === 'string' ? content.text.trim() : '';
      } catch {
        text = '';
      }
      if (msgType !== 'text' || !text) return;
      const mentions = Array.isArray(message.mentions) ? message.mentions : [];
      if (chatType === 'group' && mentions.length === 0 && !text.includes('@')) return;
      const senderId = String(nested(sender ?? {}, 'sender_id', 'open_id') ?? message.sender_id ?? 'user');
      const replyText = await handleImMessage({
        channel: 'feishu',
        chatId,
        senderName: senderId.slice(-6),
        text,
        dedupeKey: String(message.message_id ?? '') || undefined,
      });
      if (replyText) await reply(chatId, replyText);
    },
  });
  ws = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info,
    autoReconnect: true,
  });
  try {
    void ws.start({ eventDispatcher: dispatcher });
    setImRuntime('feishu', 'connected');
  } catch (err) {
    setImRuntime('feishu', 'error', err instanceof Error ? err.message : String(err));
  }
}

export async function stopFeishu(): Promise<void> {
  generation += 1;
  try {
    ws?.close({ force: true });
  } catch {
    /* ignore */
  }
  ws = null;
  rest = null;
  setImRuntime('feishu', 'idle');
}
