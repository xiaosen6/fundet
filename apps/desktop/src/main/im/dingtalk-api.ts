/**
 * 钉钉服务端 API 客户端（机制照 Cindy lizi-im dingtalk/api.ts 手工移植，裁剪）：
 * - access token 双轨：api.dingtalk.com v1.0（robot 收发）与 oapi gettoken（媒体上传），
 *   各自缓存、提前 60s 刷新；
 * - 图片下载：robot/messageFiles/download 拿签名 URL → 受限重定向跟随（仅钉钉域）+
 *   20MB 上限 + 魔数校验；
 * - 图片上传：oapi media/upload multipart → media_id；
 * - 发送：sessionWebhook 优先（带过期判定），失效回退 robot 主动发（群 groupMessages/
 *   单聊 oToMessages batchSend，sampleText / sampleImageMsg）。
 */
const ACCESS_TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const OAPI_ACCESS_TOKEN_URL = 'https://oapi.dingtalk.com/gettoken';
const OAPI_MEDIA_UPLOAD_URL = 'https://oapi.dingtalk.com/media/upload';
const DOWNLOAD_URL = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download';
const DIRECT_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const GROUP_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';

export const MAX_DINGTALK_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MEDIA_REDIRECTS = 3;
const HTTP_TIMEOUT_MS = 30_000;

export interface DingTalkOutboundTarget {
  kind: 'direct' | 'group';
  id: string;
  sessionWebhook: string | null;
  sessionWebhookExpiresAt: number | null;
}

interface AccessTokenCache {
  value: string;
  expiresAt: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function stringField(payload: unknown, key: string): string {
  return isRecord(payload) && typeof payload[key] === 'string' ? (payload[key] as string) : '';
}
function numberField(payload: unknown, key: string): number | null {
  const v = isRecord(payload) ? payload[key] : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** 魔数嗅探（Cindy detectImageMime 同源集） */
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'png';
  }
}

function validateDownloadedImage(buffer: Uint8Array, mimeType?: string): { buffer: Uint8Array; mimeType: string } {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_DINGTALK_IMAGE_BYTES) {
    throw new Error('dingtalk media has an invalid image size');
  }
  const detected = detectImageMime(buffer);
  if (!detected) throw new Error('dingtalk media is not an image');
  if (mimeType && mimeType !== detected && !mimeType.includes('application/octet-stream')) {
    throw new Error('dingtalk media mime mismatch');
  }
  return { buffer, mimeType: detected };
}

/** 签名媒体 URL 只允许钉钉域（重定向也逐跳校验） */
function isAllowedMediaHost(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    (url.hostname === 'dl.dingtalk.com' ||
      url.hostname.endsWith('.dingtalk.com') ||
      url.hostname.endsWith('.alicdn.com'))
  );
}

function isRedirectResponse(res: Response): boolean {
  return res.status >= 300 && res.status < 400;
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('dingtalk media exceeds the image size limit');
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class DingTalkApiClient {
  private accessToken: AccessTokenCache | null = null;
  private oapiAccessToken: AccessTokenCache | null = null;
  private closed = false;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
  ) {}

  close(): void {
    this.closed = true;
    this.accessToken = null;
    this.oapiAccessToken = null;
  }

  async validateCredentials(): Promise<void> {
    await this.getAccessToken();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('dingtalk api client closed');
  }

  private async fetchJson(url: URL | string, init: RequestInit): Promise<unknown> {
    this.assertOpen();
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: 'error',
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`dingtalk API request failed: HTTP ${res.status}`);
    if (isRecord(payload)) {
      const code = payload['code'];
      const legacyCode = payload['errcode'];
      if (
        (typeof code === 'string' && code && code !== '0') ||
        (typeof code === 'number' && code !== 0) ||
        (typeof legacyCode === 'string' && legacyCode && legacyCode !== '0') ||
        (typeof legacyCode === 'number' && legacyCode !== 0)
      ) {
        throw new Error(`dingtalk API error: ${String(code ?? legacyCode)} ${String(payload['errmsg'] ?? '')}`.trim());
      }
    }
    return payload;
  }

  async getAccessToken(): Promise<string> {
    this.assertOpen();
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > Date.now()) {
      return this.accessToken.value;
    }
    const payload = await this.fetchJson(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret }),
    });
    const value = stringField(payload, 'accessToken');
    if (!value) throw new Error('dingtalk access token response is invalid');
    const expiresIn = numberField(payload, 'expireIn') ?? 7200;
    this.accessToken = { value, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
    return value;
  }

  private async getOapiAccessToken(): Promise<string> {
    this.assertOpen();
    if (this.oapiAccessToken && this.oapiAccessToken.expiresAt - 60_000 > Date.now()) {
      return this.oapiAccessToken.value;
    }
    const url = new URL(OAPI_ACCESS_TOKEN_URL);
    url.searchParams.set('appkey', this.appKey);
    url.searchParams.set('appsecret', this.appSecret);
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), redirect: 'error' });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`dingtalk OAPI auth failed: HTTP ${res.status}`);
    const value = stringField(payload, 'access_token');
    const errorCode = numberField(payload, 'errcode');
    if (!value || (errorCode !== null && errorCode !== 0)) {
      throw new Error('dingtalk OAPI access token response is invalid');
    }
    const expiresIn = numberField(payload, 'expires_in') ?? 7200;
    this.oapiAccessToken = { value, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
    return value;
  }

  /** webhook 可用性：https + 钉钉域 + 未过期 */
  isWebhookUsable(target: DingTalkOutboundTarget): boolean {
    if (!target.sessionWebhook) return false;
    let url: URL;
    try {
      url = new URL(target.sessionWebhook);
    } catch {
      return false;
    }
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'api.dingtalk.com' && url.hostname !== 'oapi.dingtalk.com')
    ) {
      return false;
    }
    return target.sessionWebhookExpiresAt === null || target.sessionWebhookExpiresAt > Date.now();
  }

  /** 发文本：webhook 优先，失效回退 robot 主动发 */
  async sendText(target: DingTalkOutboundTarget, text: string): Promise<void> {
    if (target.sessionWebhook && this.isWebhookUsable(target)) {
      try {
        await this.postWebhook(target.sessionWebhook, {
          msgtype: 'text',
          text: { content: text },
        });
        return;
      } catch {
        // webhook 过期/失效：下面的主动发是兜底
      }
    }
    const token = await this.getAccessToken();
    const body =
      target.kind === 'group'
        ? {
            robotCode: this.appKey,
            openConversationId: target.id,
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content: text }),
          }
        : {
            robotCode: this.appKey,
            userIds: [target.id],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content: text }),
          };
    await this.fetchJson(target.kind === 'group' ? GROUP_SEND_URL : DIRECT_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
    });
  }

  /** 上传图片拿 media_id（oapi multipart；media_id 前导 @ 剥掉） */
  async uploadImage(bytes: Uint8Array, filename?: string): Promise<string> {
    this.assertOpen();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DINGTALK_IMAGE_BYTES) {
      throw new Error('dingtalk outbound image has an invalid size');
    }
    const mimeType = detectImageMime(bytes);
    if (!mimeType) throw new Error('dingtalk outbound media is not an image');
    const token = await this.getOapiAccessToken();
    const url = new URL(OAPI_MEDIA_UPLOAD_URL);
    url.searchParams.set('access_token', token);
    url.searchParams.set('type', 'image');
    const form = new FormData();
    // 拷贝可见视图，防 Buffer 池化底仓把 offset 外字节带进 multipart（Cindy 同款防御）
    const arrayBuffer = new Uint8Array(bytes).buffer;
    form.append(
      'media',
      new Blob([arrayBuffer], { type: mimeType }),
      filename || `image.${extensionForMime(mimeType)}`,
    );
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      body: form,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`dingtalk media upload failed: HTTP ${res.status}`);
    const errorCode = numberField(payload, 'errcode');
    const rawMediaId = stringField(payload, 'media_id');
    if (!rawMediaId || (errorCode !== null && errorCode !== 0)) {
      throw new Error('dingtalk media upload response is invalid');
    }
    return rawMediaId.startsWith('@') ? rawMediaId.slice(1) : rawMediaId;
  }

  /** 发已上传图片：robot 主动发（webhook 不支持 media 图片） */
  async sendUploadedImage(target: DingTalkOutboundTarget, mediaId: string): Promise<void> {
    const token = await this.getAccessToken();
    const body =
      target.kind === 'group'
        ? {
            robotCode: this.appKey,
            openConversationId: target.id,
            msgKey: 'sampleImageMsg',
            msgParam: JSON.stringify({ photoURL: `@${mediaId}` }),
          }
        : {
            robotCode: this.appKey,
            userIds: [target.id],
            msgKey: 'sampleImageMsg',
            msgParam: JSON.stringify({ photoURL: `@${mediaId}` }),
          };
    await this.fetchJson(target.kind === 'group' ? GROUP_SEND_URL : DIRECT_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
    });
  }

  async sendImage(target: DingTalkOutboundTarget, bytes: Uint8Array, filename?: string): Promise<void> {
    const mediaId = await this.uploadImage(bytes, filename);
    await this.sendUploadedImage(target, mediaId);
  }

  /** 下载入站图片：downloadCode → 签名 URL → 受限跟随重定向 → 魔数校验 */
  async downloadImage(downloadCode: string): Promise<{ buffer: Uint8Array; mimeType: string }> {
    const token = await this.getAccessToken();
    const payload = await this.fetchJson(DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify({ downloadCode, robotCode: this.appKey }),
    });
    const downloadUrl = stringField(payload, 'downloadUrl');
    if (!downloadUrl) throw new Error('dingtalk media response missing downloadUrl');
    const normalized = normalizeMediaDownloadUrl(downloadUrl);
    let currentUrl = new URL(normalized);
    for (let redirects = 0; redirects <= MAX_MEDIA_REDIRECTS; redirects += 1) {
      if (!isAllowedMediaHost(currentUrl)) {
        throw new Error('dingtalk media response returned an untrusted URL');
      }
      const res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!isRedirectResponse(res)) {
        if (!res.ok) throw new Error(`dingtalk media download failed: HTTP ${res.status}`);
        return validateDownloadedImage(await readBodyLimited(res, MAX_DINGTALK_IMAGE_BYTES));
      }
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new Error('dingtalk media redirect is missing a location');
      if (redirects === MAX_MEDIA_REDIRECTS) throw new Error('dingtalk media response has too many redirects');
      currentUrl = new URL(location, currentUrl);
    }
    throw new Error('dingtalk media response has too many redirects');
  }

  private async postWebhook(url: string, body: Record<string, unknown>): Promise<void> {
    this.assertOpen();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`dingtalk webhook failed: HTTP ${res.status}`);
  }
}

/** 签名 URL 里可能带临时凭证查询串——归一化只保协议/主机/路径用于域校验 */
function normalizeMediaDownloadUrl(url: string): string {
  return url;
}
