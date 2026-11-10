import * as Lark from '@larksuiteoapi/node-sdk';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';
import { captureImTurnConnection, sendImTextChunks, type ImTurnConnection } from './turn-connection.ts';

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

async function reply(connection: ImTurnConnection<Lark.Client>, chatId: string, text: string): Promise<void> {
  // 每个分块都复核代次，并使用入站时捕获的 client；stop/start 后旧回合不再外发。
  await sendImTextChunks(connection, chunkImText(text), async (client, chunk) => {
    await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: chunk }),
      },
    });
  });
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
      if (gen !== generation || !rest) return;
      // 连接在整个异步回合里固定：即使 stop/start 换了全局 rest，也只能用旧 client
      // 且必须先通过代次检查；否则旧回合会落到新账号。
      const connection = captureImTurnConnection(rest, gen, () => generation);
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
      const mentions = Array.isArray(message.mentions) ? message.mentions : [];
      if (chatType === 'group' && mentions.length === 0 && !text.includes('@')) return;
      if (msgType !== 'text') {
        // 已通过私聊/群内@门槛的非文本消息必须给用户可见反馈，不能静默丢弃。
        await reply(connection, chatId, `暂不支持${msgType || '该类型'}消息。`);
        return;
      }
      if (!text) return;
      const senderId = String(nested(sender ?? {}, 'sender_id', 'open_id') ?? message.sender_id ?? 'user');
      const replyText = await handleImMessage({
        channel: 'feishu',
        chatId,
        senderName: senderId.slice(-6),
        text,
        dedupeKey: String(message.message_id ?? '') || undefined,
      });
      if (replyText && connection.isCurrent()) await reply(connection, chatId, replyText);
    },
  });
  ws = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info,
    autoReconnect: true,
  });
  try {
    await ws.start({ eventDispatcher: dispatcher });
    if (gen !== generation) return;
    setImRuntime('feishu', 'connected');
  } catch (err) {
    if (gen !== generation) return;
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
