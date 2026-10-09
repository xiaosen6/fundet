/**
 * Lightbox 缩放/平移的纯数学（Cindy #5104 lightboxGestures 思路）。
 *
 * 视图状态 View = { scale, tx, ty }：内容以「视口中心」为基准做
 * translate(tx, ty) scale(s)（transform-origin 居中）；scale=1 即 fit
 * 尺寸居中，>1 放大、<1 缩小，范围 [MIN_SCALE, MAX_SCALE]。全部纯函数，
 * Lightbox.tsx 与 node --test 共用。
 */

export type Point = { x: number; y: number };
export type Translation = { tx: number; ty: number };
export type Bounds = { width: number; height: number };
export type View = { scale: number; tx: number; ty: number };

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;

/** 滚轮一格 ±10%；触控板的小增量按比例累积，自然平滑 */
const WHEEL_STEP = 1.1;
const WHEEL_NOTCH_PX = 100;
const WHEEL_LINE_PX = 33;

export const RESET_VIEW: View = { scale: 1, tx: 0, ty: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * clamp 图片中心至少留在视口内：中心 = 视口中心 + (tx, ty)，
 * 即 |tx| <= width/2 且 |ty| <= height/2。
 */
export function clampTranslation(tx: number, ty: number, bounds: Bounds): Translation {
  const maxX = bounds.width / 2;
  const maxY = bounds.height / 2;
  return {
    tx: Math.min(maxX, Math.max(-maxX, tx)),
    ty: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

/**
 * 以 point（视口坐标）为锚点缩放 factor 倍：光标下的内容点缩放前后不动，
 * 即 t' = p - (p - t) * (next / scale)。缩到 <=1x（fit 以内）时回正居中。
 */
export function zoomAtPoint(
  scale: number,
  origin: Translation,
  point: Point,
  factor: number,
  bounds: Bounds,
): View {
  const next = clampScale(scale * factor);
  if (next <= 1) return { scale: next, tx: 0, ty: 0 };
  const px = point.x - bounds.width / 2;
  const py = point.y - bounds.height / 2;
  const ratio = next / scale;
  const { tx, ty } = clampTranslation(
    px - (px - origin.tx) * ratio,
    py - (py - origin.ty) * ratio,
    bounds,
  );
  return { scale: next, tx, ty };
}

/** 平移到 (tx, ty) 后 clamp；scale <= 1（fit 以内）不平移，回正居中。 */
export function panView(scale: number, tx: number, ty: number, bounds: Bounds): View {
  if (scale <= 1) return { scale, tx: 0, ty: 0 };
  return { scale, ...clampTranslation(tx, ty, bounds) };
}

/** 滚轮增量 → 缩放系数：一格（100px 或 3 行）≈ ±10%。 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaY;
  return Math.pow(WHEEL_STEP, -px / WHEEL_NOTCH_PX);
}
