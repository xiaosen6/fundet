import { WSClient } from '@wecom/aibot-node-sdk';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';
import { captureImTurnConnection, sendImTextChunks, type ImTurnConnection } from './turn-connection.ts';

let client: WSClient | null = null;
let generation = 0;

export async function startWecom(): Promise<void> {
  const creds = readImCreds('wecom');
  const botId = creds?.botId?.trim() ?? '';
  const secret = creds?.secret?.trim() ?? '';
  if (!botId || !secret) {
    setImRuntime('wecom', 'idle');
    return;
  }
  await stopWecom();
  const gen = ++generation;
  setImRuntime('wecom', 'connecting');
  const ws = new WSClient({
    botId,
    secret,
    maxReconnectAttempts: -1,
  });
  client = ws;
  ws.on('authenticated', () => {
    if (gen === generation) setImRuntime('wecom', 'connected');
  });
  ws.on('error', (err: unknown) => {
    if (gen !== generation) return;
    const msg = err instanceof Error ? err.message : String(err);
    setImRuntime('wecom', 'error', msg);
  });
  const onText = (frame: { body?: { msgid?: string; chatid?: string; chattype?: string; from?: { userid?: string }; text?: { content?: string } } }) => {
    void (async () => {
      if (gen !== generation) return;
      const body = frame.body;
      if (!body?.from?.userid) return;
      const text = String(body.text?.content ?? '').trim();
      if (!text) return;
      const group = body.chattype === 'group';
      const chatId = group ? String(body.chatid || body.from.userid) : body.from.userid;
      if (group && !text.includes('@')) return;
      // 连接在整个异步回合里固定：stop/start 换了全局 client 后，旧回合（含
      // 审批桥的外发）只能用旧 client 且须过代次检查（与飞书同款，2026-11-24 补）
      const connection: ImTurnConnection<WSClient> = captureImTurnConnection(ws, gen, () => generation);
      const replyText = await handleImMessage(
        {
          channel: 'wecom',
          chatId,
          senderName: body.from.userid.slice(-6),
          text,
          dedupeKey: String(body.msgid ?? '') || undefined,
        },
        // 审批/提问桥的送达通道（2026-11-24 修复：此前只有钉钉传 reply）。
        // 经入站时捕获的连接外发——stop/start 换连接后旧回合不再外发。
        {
          reply: async (promptText) => {
            await sendImTextChunks(connection, chunkImText(promptText), async (client, chunk) => {
              await client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: chunk } });
            });
          },
        },
      );
      if (!replyText || gen !== generation) return;
      try {
        for (const chunk of chunkImText(replyText)) {
          await ws.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: chunk } });
        }
      } catch (err) {
        console.warn('[fundet:im:wecom] reply failed', err);
      }
    })();
  };
  ws.on('message.text', onText);
  try {
    ws.connect();
  } catch (err) {
    if (gen === generation) {
      setImRuntime('wecom', 'error', err instanceof Error ? err.message : String(err));
    }
  }
}

export async function stopWecom(): Promise<void> {
  generation += 1;
  try {
    client?.disconnect();
  } catch {
    /* ignore */
  }
  client = null;
  setImRuntime('wecom', 'idle');
}
