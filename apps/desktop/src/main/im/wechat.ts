import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { TencentIlinkTransport } from './wechat-ilink/transport.ts';
import type { WechatAuthorizationObserver, WechatCredentials } from './wechat-ilink/types.ts';
import { chunkImText, handleImMessage } from './dispatcher.ts';
import { composeInboundText, sniffImageMime, splitInboundMedia } from './wechat-inbound.ts';
import { clearImCreds, readImCreds, writeImCreds } from './secrets.ts';
import { setImRuntime } from './runtime.ts';
import { getSetting, setSetting } from '../db/settings.js';
import { brand } from '../../shared/brand.ts';

const BASE = 'https://ilinkai.weixin.qq.com';
const CURSOR_KEY = 'im.wechat.cursor';

let pollAbort: AbortController | null = null;
let qrAbort: AbortController | null = null;
let qrCanceled = false;
let active: TencentIlinkTransport | null = null;
let creds: WechatCredentials | null = null;

/**
 * qrcode_img_content 是 liteapp 网页（HTML），不是图片直链——fetch 回来只能得到
 * 一张裂图。二维码内容就是该 URL 本身，本地生成 PNG data URL（渲染进程 CSP 禁外链图）。
 */
async function qrToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  return QRCode.toDataURL(url, { margin: 1, width: 320 });
}

function makeTransport(token?: string, observer?: WechatAuthorizationObserver): TencentIlinkTransport {
  return new TencentIlinkTransport({
    baseUrl: BASE,
    token,
    botAgent: `${brand.name}/0.0.1`,
    clientVersion: '0.0.1',
    fetch: globalThis.fetch.bind(globalThis),
    authorizationObserver: observer,
  });
}

function loadCreds(): WechatCredentials | null {
  const raw = readImCreds('wechat');
  if (!raw?.token || !raw.botId || !raw.userId) return null;
  return {
    token: raw.token,
    botId: raw.botId,
    userId: raw.userId,
    baseUrl: raw.baseUrl || BASE,
  };
}

async function pollLoop(transport: TencentIlinkTransport, stored: WechatCredentials): Promise<void> {
  const ac = new AbortController();
  pollAbort = ac;
  let cursor = getSetting(CURSOR_KEY) ?? '';
  const contextByPeer = new Map<string, string>();
  // 连接成功才置 connected（此前 startWechat 先行置位，notifyStart 网络失败时
  // 假在线 + unhandled rejection）
  try {
    await transport.notifyStart(ac.signal);
    setImRuntime('wechat', 'connected');
    console.log('[fundet:im/wechat] 已连接，开始长轮询', { botId: stored.botId, userId: stored.userId });
  } catch (err) {
    if (!ac.signal.aborted) {
      setImRuntime('wechat', 'error', err instanceof Error ? err.message : String(err));
    }
    return;
  }
  while (!ac.signal.aborted) {
    try {
      const result = await transport.poll(cursor, ac.signal);
      cursor = result.cursor;
      setSetting(CURSOR_KEY, cursor);
      for (const msg of result.messages) {
        const { images: imageRefs, otherCount } = splitInboundMedia(msg.media);
        console.log('[fundet:im/wechat] 入站消息', {
          from: msg.senderId.slice(-6),
          len: msg.text.length,
          images: imageRefs.length,
          otherMedia: otherCount,
          preview: msg.text.slice(0, 30),
        });
        // 纯空消息跳过；带图片/附件的消息即使无文字也要进回合
        if (!msg.text.trim() && msg.media.length === 0) continue;
        // 只挡机器人自己发的（防回环）。个人微信场景下用户本人发给机器人的消息
        // senderId == userId，这正是「给自己派活」的主流程，不能过滤；
        // 带 recipient 且不是发给本机器人的才跳过。
        if (msg.senderId === stored.botId) {
          console.log('[fundet:im/wechat] 跳过机器人自己发的消息');
          continue;
        }
        if (msg.recipientId && msg.recipientId !== stored.botId) {
          console.log('[fundet:im/wechat] 跳过非发给本机器人的消息', { to: msg.recipientId.slice(-6) });
          continue;
        }
        contextByPeer.set(msg.senderId, msg.contextToken);
        // 图片在入队前下载（dispatcher 的 downloadImages 回调无法回注降级文字）；
        // 逐张容错，失败的以文字说明告知模型，不静默吞
        const images: Array<{ buffer: Uint8Array; mimeType: string }> = [];
        let failedImages = 0;
        let failReason = '';
        for (const ref of imageRefs) {
          try {
            const bytes = await transport.downloadMedia(ref, ac.signal);
            images.push({ buffer: bytes, mimeType: sniffImageMime(bytes) });
          } catch (err) {
            failedImages += 1;
            failReason = err instanceof Error ? err.message : String(err);
            console.warn('[fundet:im/wechat] 图片下载失败（降级为文字说明）', {
              messageId: msg.messageId,
              reason: failReason,
            });
          }
        }
        if (ac.signal.aborted) return;
        const text = composeInboundText(msg.text, {
          total: imageRefs.length,
          failed: failedImages,
          reason: failReason,
          otherCount,
        });
        const reply = await handleImMessage(
          {
            channel: 'wechat',
            chatId: msg.senderId,
            senderName: msg.senderId.slice(-6),
            text,
            dedupeKey: msg.messageId,
          },
          images.length > 0 ? { downloadImages: () => Promise.resolve(images) } : undefined,
        );
        if (!reply) continue;
        const chunks = chunkImText(reply, 1800);
        for (const chunk of chunks) {
          await transport.sendMessage(
            {
              peerId: msg.senderId,
              text: chunk,
              contextToken: contextByPeer.get(msg.senderId) || msg.contextToken,
              clientId: randomUUID(),
            },
            ac.signal,
          );
        }
        console.log('[fundet:im/wechat] 已回复', { to: msg.senderId.slice(-6), chunks: chunks.length });
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('AUTH_REPLACED') || msg.includes('no longer active')) {
        setImRuntime('wechat', 'error', '微信登录已失效，请重新扫码');
        return;
      }
      console.warn('[fundet:im/wechat] 轮询异常，2s 后重试:', msg);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function startWechat(): Promise<void> {
  const stored = loadCreds();
  if (!stored) {
    setImRuntime('wechat', 'idle');
    return;
  }
  await stopWechat();
  creds = stored;
  const transport = makeTransport(stored.token);
  active = transport;
  setImRuntime('wechat', 'connecting');
  // pollLoop 内部自收口：连接成功置 connected、失败置 error，这里只兜未预期异常
  void pollLoop(transport, stored).catch((err) => {
    setImRuntime('wechat', 'error', err instanceof Error ? err.message : String(err));
  });
}

export async function startWechatQr(): Promise<string> {
  await stopWechat();
  qrCanceled = false;
  qrAbort?.abort();
  const ac = new AbortController();
  qrAbort = ac;
  const transport = makeTransport(undefined, {
    onEvent: async (event) => {
      if (event.status === 'qr-refreshed') {
        try {
          const data = await qrToDataUrl(event.challenge.qrCodeUrl);
          setImRuntime('wechat', 'connecting', '请用微信扫码', data);
        } catch {
          setImRuntime('wechat', 'connecting', '二维码已刷新，请点「扫码连接」重试', null);
        }
      } else if (event.status === 'scanned') {
        setImRuntime('wechat', 'connecting', '已扫码，请在手机上确认');
      }
    },
  });
  setImRuntime('wechat', 'connecting', '正在获取二维码', null);
  const challenge = await transport.beginAuthorization(ac.signal);
  let display: string;
  try {
    display = await qrToDataUrl(challenge.qrCodeUrl);
  } catch (err) {
    setImRuntime(
      'wechat',
      'error',
      `二维码无法显示：${err instanceof Error ? err.message : String(err)}。可点「开放平台」或重试。`,
      null,
    );
    throw err;
  }
  setImRuntime('wechat', 'connecting', '请用微信扫码', display);
  void transport
    .waitAuthorization(challenge, ac.signal)
    .then(async (got) => {
      writeImCreds('wechat', {
        token: got.token,
        botId: got.botId,
        userId: got.userId,
        baseUrl: got.baseUrl || BASE,
      });
      creds = got;
      if (qrCanceled) {
        // 用户在授权落定前点了取消：保留凭证但不启动轮询（下次「连接」直接用）
        active = null;
        setImRuntime('wechat', 'idle', undefined, null);
        return;
      }
      active = makeTransport(got.token);
      void pollLoop(active, got).catch((err) => {
        setImRuntime('wechat', 'error', err instanceof Error ? err.message : String(err));
      });
    })
    .catch((err) => {
      if (ac.signal.aborted) {
        setImRuntime('wechat', 'idle', undefined, null);
        return;
      }
      setImRuntime('wechat', 'error', err instanceof Error ? err.message : String(err), null);
    });
  return display;
}

export function cancelWechatQr(): void {
  // 授权可能已成功、轮询已在跑——只 abort qrAbort 拦不住 pollLoop，
  // 会出现「UI 显示未连接、消息照收」；统一走 stopWechat 连轮询一起停
  qrCanceled = true;
  void stopWechat();
}

export async function stopWechat(): Promise<void> {
  qrAbort?.abort();
  qrAbort = null;
  pollAbort?.abort();
  pollAbort = null;
  if (active && creds) {
    try {
      await active.notifyStop(new AbortController().signal);
    } catch {
      /* ignore */
    }
  }
  active = null;
  setImRuntime('wechat', 'idle', undefined, null);
}

export async function clearWechat(): Promise<void> {
  await stopWechat();
  clearImCreds('wechat');
}
