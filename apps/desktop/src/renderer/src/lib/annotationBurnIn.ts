/**
 * annotationBurnIn —— 标注烧录（移植 Cindy lib/annotationBurnIn.ts 的烧录核心）。
 *
 * Cindy 是惰性烧录（矢量笔迹随附件持久化，发送时统一物化）；Fundet 的附件
 * 契约是「保存即替换 chip」——保存时立刻烧录成新 File 交回调用方走
 * onAddFiles 管线。源恒为 renderer 拿到的 data: URL（readFileDataUrl），
 * 无跨源 taint 问题。
 */
import {
  drawStrokesOnCanvas,
  type AnnotationStroke,
} from './lightboxAnnotations.ts';

/** data:image/...;base64, → {base64, mimeType}；其余形式返回 null。 */
export function dataUrlToSource(src: string): { base64: string; mimeType: string } | null {
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(src);
  if (!m) return null;
  return { base64: m[2]!, mimeType: m[1]! };
}

/**
 * 烧录：原图 → canvas（自然尺寸）→ 重放笔迹 → 位图 Blob。
 * JPEG 源保持 JPEG（避免照片转 PNG 体积爆炸），其余 PNG。
 */
export async function burnInAnnotations(
  source: { base64: string; mimeType: string },
  strokes: readonly AnnotationStroke[],
  outMimeOverride?: 'image/png' | 'image/jpeg',
): Promise<{ blob: Blob; mimeType: string }> {
  const image = new Image();
  image.src = `data:${source.mimeType};base64,${source.base64}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
  drawStrokesOnCanvas(ctx, strokes, image.naturalWidth, image.naturalHeight);

  const outMime =
    outMimeOverride ?? (source.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png');
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, 0.92),
  );
  if (!blob) throw new Error('encode failed');
  return { blob, mimeType: outMime };
}

/** 烧录文件名：原名-标注.<ext>；重复编辑幂等（不再叠加 -标注）。 */
export function annotatedFileName(name: string, ext: '.png' | '.jpg'): string {
  const base = name.replace(/\.[^.]+$/u, '');
  const stripped = base.endsWith('-标注') ? base.slice(0, -'-标注'.length) : base;
  return `${stripped || 'image'}-标注${ext}`;
}
