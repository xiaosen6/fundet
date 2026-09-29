/**
 * 微信入站媒体辅助（纯函数，node --test 直测）：
 * - iLink 媒体不携带 MIME，sniffImageMime 按魔数嗅探（默认 jpeg，C2C 图主流格式）；
 * - composeInboundText 合成下载降级说明——图片下载失败/非图片附件不静默吞，
 *   纯图全失败也照常产出一条给模型的文字。
 */
import type { WechatMediaRef } from './wechat-ilink/types.ts';

/** 图片魔数嗅探；未知字节按微信 C2C 主流格式兜底为 jpeg */
export function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

export interface WechatInboundMediaSplit {
  /** 可下载的图片引用 */
  images: WechatMediaRef[];
  /** 暂不支持读取的非图片附件数（文件/视频/无识别文字的语音） */
  otherCount: number;
}

/** 图片与其余附件分流；带识别文字的语音正文已在 text 里，不算附件缺口 */
export function splitInboundMedia(media: WechatMediaRef[]): WechatInboundMediaSplit {
  const images = media.filter((m) => m.kind === 'image');
  const otherCount = media.filter(
    (m) => m.kind !== 'image' && !(m.kind === 'voice' && m.transcript?.trim()),
  ).length;
  return { images, otherCount };
}

export interface WechatImageDownloadOutcome {
  /** 消息里的图片总数 */
  total: number;
  /** 下载失败张数 */
  failed: number;
  /** 最后一次失败原因（可省） */
  reason?: string;
  /** 非图片附件数 */
  otherCount: number;
}

/** 原文 + 降级说明合成；无降级时原文原样返回 */
export function composeInboundText(text: string, outcome: WechatImageDownloadOutcome): string {
  const notes: string[] = [];
  const reason = outcome.reason ? `（${outcome.reason}）` : '';
  if (outcome.failed > 0) {
    notes.push(
      outcome.failed === outcome.total
        ? `用户发来 ${outcome.total} 张图片但下载失败${reason}，无法查看图片内容。`
        : `用户发来 ${outcome.total} 张图片，其中 ${outcome.failed} 张下载失败${reason}，仅收到 ${outcome.total - outcome.failed} 张。`,
    );
  }
  if (outcome.otherCount > 0) {
    notes.push(`用户还发来 ${outcome.otherCount} 个非图片附件（文件/视频/语音），内容暂无法读取。`);
  }
  if (notes.length === 0) return text;
  return [text.trim(), ...notes].filter(Boolean).join('\n');
}
