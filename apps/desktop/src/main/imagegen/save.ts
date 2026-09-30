/**
 * 生成图片落盘：<workdir>/fundet-images/<hhmmss>-<slug>.<ext>（魔数定扩展名）。
 * 目录不隐藏（用户要在资源管理器里找到生成的图）；非 workdir 根直落避免污染根目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { sniffImageMime } from '../../shared/file-kind.ts';
import type { ImageGenResult } from '../../shared/imagegen.ts';

function extOf(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 16);
  const mime = sniffImageMime(head, 'image/png');
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

export async function saveGeneratedImage(
  workdir: string,
  result: ImageGenResult,
  slug: string,
): Promise<string> {
  const dir = path.join(workdir, 'fundet-images');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date();
  const hh = String(ts.getHours()).padStart(2, '0');
  const mm = String(ts.getMinutes()).padStart(2, '0');
  const ss = String(ts.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  const rel = `fundet-images/${hh}${mm}${ss}-${slug}-${rand}.${extOf(result.bytes)}`;
  fs.writeFileSync(path.join(workdir, rel), result.bytes);
  return rel;
}
