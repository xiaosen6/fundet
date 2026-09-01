import { WSClient } from '@wecom/aibot-node-sdk';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { readImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';

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
      const replyText = await handleImMessage({
        channel: 'wecom',
        chatId,
        senderName: body.from.userid.slice(-6),
        text,
        dedupeKey: String(body.msgid ?? '') || undefined,
      });
      if (!replyText || gen !== generation) return;
      try {
        for (const chunk of chunkImText(replyText)) {
          await ws.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: chunk } });
        }
      } catch (err) {
        console.warn('[longma:im:wecom] reply failed', err);
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
