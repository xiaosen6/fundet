/**
 * 钉钉入站解析（纯函数，机制照 Cindy lizi-im dingtalk/inbound.ts 手工移植，
 * 测试即规格书）。信封校验会话/发送者身份；内容按 msgtype 分派：
 * text/richText → 文本（richText 递归抽文本与图片 downloadCode）；
 * picture → 图片 downloadCode；audio → 语音识别文字（无识别则不支持）；
 * video/file → 不支持清单。
 */

export interface DingTalkInboundEnvelope {
  conversationId: string;
  conversationType: '1' | '2';
  messageId: string;
  messageType: string;
  robotCode: string;
  senderId: string;
  senderStaffId: string;
  senderName: string;
  sessionWebhook: string | null;
  sessionWebhookExpiresAt: number | null;
  mentioned: boolean;
  raw: Record<string, unknown>;
}

export interface DingTalkInboundContent {
  text: string;
  downloadCodes: string[];
  /** 不支持的消息类型（label 供回复提示） */
  unsupported: Array<{ type: string; label: string }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function readString(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : '';
}
function readFiniteNumber(raw: Record<string, unknown>, key: string): number | null {
  const v = raw[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function readNestedString(raw: Record<string, unknown>, outer: string, inner: string): string {
  const mid = raw[outer];
  return isRecord(mid) && typeof mid[inner] === 'string' ? (mid[inner] as string) : '';
}
function normalizeEpochMs(v: number | null): number | null {
  return v !== null && v > 0 ? v : null;
}

/** @ 判定：isInAtList 或正文以 @机器人名/@staffId 开头（Cindy isBotMentioned 简化版） */
function isBotMentioned(raw: Record<string, unknown>, robotCode: string): boolean {
  if (raw['isInAtList'] === true) return true;
  const text = readNestedString(raw, 'text', 'content');
  return text.includes(`@${robotCode}`) || text.includes('@');
}

export function parseInboundEnvelope(raw: unknown): DingTalkInboundEnvelope | null {
  if (!isRecord(raw)) return null;
  const conversationId = readString(raw, 'conversationId');
  const conversationType = readString(raw, 'conversationType');
  const messageId = readString(raw, 'msgId');
  const messageType = readString(raw, 'msgtype') || readString(raw, 'messageType');
  const robotCode = readString(raw, 'robotCode') || readString(raw, 'senderCorpId') || 'robot';
  const senderId = readString(raw, 'senderId');
  const senderStaffId = readString(raw, 'senderStaffId');
  if (
    !conversationId
    || (conversationType !== '1' && conversationType !== '2')
    || !messageType
    || (!senderId && !senderStaffId)
  ) {
    return null;
  }
  return {
    conversationId,
    conversationType,
    messageId,
    messageType,
    robotCode,
    senderId: senderStaffId || senderId,
    senderStaffId,
    senderName: readString(raw, 'senderNick') || senderStaffId.slice(-6) || '钉钉用户',
    sessionWebhook: readString(raw, 'sessionWebhook') || null,
    sessionWebhookExpiresAt: normalizeEpochMs(readFiniteNumber(raw, 'sessionWebhookExpiredTime')),
    // 单聊不需要 @（恒真）；群聊才看 @ 判定
    mentioned: conversationType === '1' ? true : isBotMentioned(raw, robotCode),
    raw,
  };
}

export function parseInboundContent(envelope: DingTalkInboundEnvelope): DingTalkInboundContent {
  const raw = envelope.raw;
  switch (envelope.messageType) {
    case 'text':
      return result(readNestedString(raw, 'text', 'content'));
    case 'richText':
      return parseRichText(raw);
    case 'picture':
      return {
        text: '',
        downloadCodes: [
          readNestedString(raw, 'content', 'downloadCode') || readString(raw, 'downloadCode'),
        ].filter(Boolean),
        unsupported: [],
      };
    case 'audio': {
      const recognition =
        readString(raw, 'recognition') || readNestedString(raw, 'content', 'recognition');
      return recognition
        ? result(recognition)
        : unsupported('audio', '语音（没有可用的文字识别结果）');
    }
    case 'video':
      return unsupported('video', '视频');
    case 'file':
      return unsupported('file', '文件');
    default:
      return unsupported(envelope.messageType, `暂不支持的消息类型 ${envelope.messageType}`);
  }
}

function result(text: string): DingTalkInboundContent {
  return { text: text.trim(), downloadCodes: [], unsupported: [] };
}

function unsupported(type: string, label: string): DingTalkInboundContent {
  return { text: '', downloadCodes: [], unsupported: [{ type, label }] };
}

/** richText：递归访问数组/对象节点，text 节点收集文本、downloadCode 节点收集图片 */
function parseRichText(raw: Record<string, unknown>): DingTalkInboundContent {
  const content = isRecord(raw['content']) ? raw['content'] : {};
  const richText = content['richText'];
  const parts: string[] = [];
  const downloadCodes: string[] = [];
  visitRichText(richText, parts, downloadCodes);
  return { text: parts.join(' ').trim(), downloadCodes, unsupported: [] };
}

function visitRichText(node: unknown, parts: string[], downloadCodes: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) visitRichText(child, parts, downloadCodes);
    return;
  }
  if (!isRecord(node)) return;
  const text = node['text'];
  if (typeof text === 'string' && text.trim() && node['type'] !== 'picture') {
    parts.push(text.trim());
  }
  const downloadCode = node['downloadCode'];
  if (typeof downloadCode === 'string' && downloadCode) downloadCodes.push(downloadCode);
  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) visitRichText(child, parts, downloadCodes);
  }
}
