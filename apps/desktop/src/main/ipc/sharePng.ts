/**
 * CLIPBOARD_WRITE_PNG handler 纯逻辑：clipboard/nativeImage 依赖注入，便于
 * node --test 直测（register.ts 挂真实 electron 实现；本文件对 electron 仅
 * type import，运行时零依赖）。PNG 魔数/IHDR 与尺寸预算校验后一次写入
 * image+text 双表示（聊天窗口吃图、纯文本框吃源码）。
 */
import type { clipboard, nativeImage } from 'electron';

export interface SharePngDeps {
  clipboard: Pick<typeof clipboard, 'write'>;
  nativeImage: Pick<typeof nativeImage, 'createFromBuffer'>;
}

export function makeSharePngWriter(
  deps: SharePngDeps,
): (png: ArrayBuffer, plainText?: string) => void {
  return (png, plainText) => {
    const bytes = Buffer.from(png ?? new ArrayBuffer(0));
    if (
      bytes.length < 24
      || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.readUInt32BE(8) !== 13
      || bytes.toString('ascii', 12, 16) !== 'IHDR'
    ) {
      throw new Error('剪贴板内容不是有效的 PNG');
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (
      !width
      || !height
      || width > 16384
      || height > 16384
      || width * height > 4096 ** 2 + 16384
    ) {
      throw new Error('分享图片尺寸超出上限');
    }
    const image = deps.nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('PNG 解码失败');
    deps.clipboard.write({
      image,
      ...(typeof plainText === 'string' && plainText ? { text: plainText } : {}),
    });
  };
}
