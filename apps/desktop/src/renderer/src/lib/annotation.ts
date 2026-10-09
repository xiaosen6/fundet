/**
 * annotation —— 图片标注的纯逻辑层（操作模型 / 撤销重做栈 / 烧录重放几何）。
 *
 * 坐标一律存归一化值（0..1，相对原图宽高），与显示比例解耦：编辑器在缩放
 * 视图上绘制，保存时 replayAnnotationOps 把操作按自然分辨率重放到 canvas。
 * node --test 可直跑（无 DOM 依赖，重放上下文为结构化接口，测试注入记录桩）。
 */

export type AnnotationTool = 'rect' | 'arrow' | 'pen' | 'text';

/** 标注三色（红/黄/蓝）：需在任意图片上高可见，取独立于主题 token 的固定色 */
export const ANNOTATION_COLORS = {
  red: '#ef4444',
  yellow: '#facc15',
  blue: '#3b82f6',
} as const;
export type AnnotationColorKey = keyof typeof ANNOTATION_COLORS;

/** 基准线宽（显示像素档位），烧录时按原图尺寸等比放大 */
export const ANNOTATION_WIDTHS = [2, 4] as const;
export type AnnotationWidth = (typeof ANNOTATION_WIDTHS)[number];

export interface Point {
  x: number;
  y: number;
}

interface OpBase {
  color: string;
}

export interface RectOp extends OpBase {
  type: 'rect';
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ArrowOp extends OpBase {
  type: 'arrow';
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PenOp extends OpBase {
  type: 'pen';
  width: number;
  points: Point[];
}

/** size 为字号相对原图最长边的比例（0.03 ≈ 最长边的 3%） */
export interface TextOp extends OpBase {
  type: 'text';
  x: number;
  y: number;
  size: number;
  text: string;
}

export type AnnotationOp = RectOp | ArrowOp | PenOp | TextOp;

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function clampPoint(p: Point): Point {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** 任意方向拖拽 → 左上角 + 宽高（反向拖拽归一） */
export function normalizeRect(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return len;
}

/** 判定一个操作是否值得入栈（过滤误触点击 / 空文本） */
export function isOpMeaningful(op: AnnotationOp): boolean {
  const MIN = 0.01;
  switch (op.type) {
    case 'rect': {
      const r = normalizeRect({ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 });
      return Math.max(r.width, r.height) >= MIN;
    }
    case 'arrow':
      return pathLength([
        { x: op.x1, y: op.y1 },
        { x: op.x2, y: op.y2 },
      ]) >= MIN;
    case 'pen':
      return pathLength(op.points) >= MIN;
    case 'text':
      return op.text.trim().length > 0;
  }
}

/** 烧录线宽：≤1000px 原图按原值；更大图按最长边等比放大（缩放视图里所见即烧录所得） */
export function strokeWidthPx(imageW: number, imageH: number, base: number): number {
  return base * Math.max(1, Math.max(imageW, imageH) / 1000);
}

/** 文字行内输入的显示字号（最长边的 3%，钳 16..72px） */
export function textFontPx(maxDim: number): number {
  return Math.min(72, Math.max(16, Math.round(maxDim * 0.03)));
}

const ARROW_SPREAD_RAD = (24 * Math.PI) / 180;

/** 箭头翼长：线宽的 3.5 倍 */
export function arrowHeadLength(lineWidthPx: number): number {
  return lineWidthPx * 3.5;
}

/** 箭头两翼端点（像素空间计算，避免归一化空间的纵横比畸变） */
export function arrowHeadWings(from: Point, to: Point, headLength: number): [Point, Point] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  return [
    {
      x: to.x - headLength * Math.cos(ang - ARROW_SPREAD_RAD),
      y: to.y - headLength * Math.sin(ang - ARROW_SPREAD_RAD),
    },
    {
      x: to.x - headLength * Math.cos(ang + ARROW_SPREAD_RAD),
      y: to.y - headLength * Math.sin(ang + ARROW_SPREAD_RAD),
    },
  ];
}

/** 烧录文件名：原名-标注.png；重复编辑幂等（不再叠加 -标注） */
export function annotatedFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/u, '');
  const stripped = base.endsWith('-标注') ? base.slice(0, -'-标注'.length) : base;
  return `${stripped || 'image'}-标注.png`;
}

// ---- 撤销 / 重做（纯状态，组件里 useState 直接持有） ----

export interface AnnotationHistoryState {
  ops: AnnotationOp[];
  redo: AnnotationOp[];
}

export const emptyAnnotationHistory: AnnotationHistoryState = { ops: [], redo: [] };

export function pushAnnotationOp(state: AnnotationHistoryState, op: AnnotationOp): AnnotationHistoryState {
  if (!isOpMeaningful(op)) return state;
  return { ops: [...state.ops, op], redo: [] };
}

export function undoAnnotationOp(state: AnnotationHistoryState): AnnotationHistoryState {
  if (state.ops.length === 0) return state;
  return { ops: state.ops.slice(0, -1), redo: [...state.redo, state.ops[state.ops.length - 1]!] };
}

export function redoAnnotationOp(state: AnnotationHistoryState): AnnotationHistoryState {
  if (state.redo.length === 0) return state;
  return { ops: [...state.ops, state.redo[state.redo.length - 1]!], redo: state.redo.slice(0, -1) };
}

export function clearAnnotations(state: AnnotationHistoryState): AnnotationHistoryState {
  return emptyAnnotationHistory;
}

// ---- 烧录重放 ----

/** 重放所需的最小 2D 上下文面（CanvasRenderingContext2D 结构满足；测试注入记录桩） */
export interface AnnotationReplayCtx {
  strokeStyle: string | CanvasGradient | CanvasPattern | null;
  fillStyle: string | CanvasGradient | CanvasPattern | null;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

const TEXT_FONT_WEIGHT = 600;
const TEXT_FONT_FAMILY = "Inter, 'Microsoft YaHei', sans-serif";

export function drawAnnotationOp(ctx: AnnotationReplayCtx, op: AnnotationOp, imageW: number, imageH: number): void {
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (op.type) {
    case 'rect': {
      const r = normalizeRect({ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 });
      ctx.lineWidth = strokeWidthPx(imageW, imageH, op.width);
      ctx.strokeRect(r.x * imageW, r.y * imageH, r.width * imageW, r.height * imageH);
      break;
    }
    case 'arrow': {
      const from = { x: op.x1 * imageW, y: op.y1 * imageH };
      const to = { x: op.x2 * imageW, y: op.y2 * imageH };
      ctx.lineWidth = strokeWidthPx(imageW, imageH, op.width);
      const head = arrowHeadLength(ctx.lineWidth);
      const [w1, w2] = arrowHeadWings(from, to, head);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(w1.x, w1.y);
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(w2.x, w2.y);
      ctx.stroke();
      break;
    }
    case 'pen': {
      if (op.points.length === 0) break;
      ctx.lineWidth = strokeWidthPx(imageW, imageH, op.width);
      ctx.beginPath();
      ctx.moveTo(op.points[0]!.x * imageW, op.points[0]!.y * imageH);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i]!.x * imageW, op.points[i]!.y * imageH);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      const fontPx = Math.max(10, op.size * Math.max(imageW, imageH));
      ctx.font = `${TEXT_FONT_WEIGHT} ${fontPx}px ${TEXT_FONT_FAMILY}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(op.text, op.x * imageW, op.y * imageH);
      break;
    }
  }
}

/** 把操作数组按自然分辨率重放到画布（烧录 = 先画原图再调本函数） */
export function replayAnnotationOps(
  ctx: AnnotationReplayCtx,
  ops: readonly AnnotationOp[],
  imageW: number,
  imageH: number,
): void {
  for (const op of ops) drawAnnotationOp(ctx, op, imageW, imageH);
}
