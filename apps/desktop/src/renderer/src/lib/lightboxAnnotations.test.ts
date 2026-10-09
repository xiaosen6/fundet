/**
 * lightboxAnnotations 单测 —— 移植 Cindy lightboxAnnotations.test.ts（vitest →
 * node --test），测试即规格书：归一化坐标、点距过滤、相对线宽、SVG path、
 * canvas 两遍重放（白描边在红线之前且更宽）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANNOTATION_OUTLINE_COLOR,
  ANNOTATION_STROKE_COLOR,
  annotationStrokeWidth,
  drawStrokesOnCanvas,
  normalizePoint,
  shouldAppendPoint,
  strokeToSvgPath,
  type StrokeCanvasContext,
} from './lightboxAnnotations.ts';
import { annotatedFileName } from './annotationBurnIn.ts';

test('normalizePoint：屏幕坐标映射到 0..1 图片空间', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(normalizePoint(300, 150, rect), { x: 0.5, y: 0.5 });
});

test('normalizePoint：越界点钳制到边缘', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(normalizePoint(0, 0, rect), { x: 0, y: 0 });
  assert.deepEqual(normalizePoint(9999, 9999, rect), { x: 1, y: 1 });
});

test('normalizePoint：退化 rect 返回 null', () => {
  assert.equal(normalizePoint(1, 1, { left: 0, top: 0, width: 0, height: 100 }), null);
});

test('shouldAppendPoint：首点恒收、低于阈值的移动丢弃', () => {
  const stroke = { points: [] as Array<{ x: number; y: number }> };
  assert.equal(shouldAppendPoint(stroke, { x: 0.5, y: 0.5 }), true);
  stroke.points.push({ x: 0.5, y: 0.5 });
  assert.equal(shouldAppendPoint(stroke, { x: 0.5005, y: 0.5 }), false);
  assert.equal(shouldAppendPoint(stroke, { x: 0.51, y: 0.5 }), true);
});

test('annotationStrokeWidth：随短边缩放，钳 [4, 24]', () => {
  assert.equal(annotationStrokeWidth(200, 100), 4);
  assert.equal(annotationStrokeWidth(4000, 2000), 10);
  assert.equal(annotationStrokeWidth(20000, 20000), 24);
});

test('strokeToSvgPath：归一化点映射到像素空间', () => {
  const d = strokeToSvgPath({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }] }, 200, 100);
  assert.equal(d, 'M 0.0 0.0 L 100.0 100.0');
});

test('strokeToSvgPath：单点笔迹渲染为圆点长度的线段', () => {
  const d = strokeToSvgPath({ points: [{ x: 0.5, y: 0.5 }] }, 200, 100);
  assert.ok(d.includes('M 100.0 50.0 L 100.1 50.0'));
});

test('strokeToSvgPath：空笔迹返回空串', () => {
  assert.equal(strokeToSvgPath({ points: [] }, 200, 100), '');
});

function fakeCtx(): { ctx: StrokeCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: (): void => calls.push('beginPath'),
    moveTo: (x: number, y: number): void => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number): void => calls.push(`lineTo(${x},${y})`),
    stroke: (): void => calls.push(`stroke:${String(ctx.strokeStyle)}:${ctx.lineWidth}`),
  } as StrokeCanvasContext & { strokeStyle: string };
  return { ctx, calls };
}

test('drawStrokesOnCanvas：白描边先于红线且线宽更大', () => {
  const { ctx, calls } = fakeCtx();
  drawStrokesOnCanvas(ctx, [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], 100, 100);
  const strokeCalls = calls.filter((c) => c.startsWith('stroke:'));
  assert.equal(strokeCalls.length, 2);
  assert.ok(strokeCalls[0]!.includes(ANNOTATION_OUTLINE_COLOR));
  assert.ok(strokeCalls[1]!.includes(ANNOTATION_STROKE_COLOR));
  const outlineWidth = Number(strokeCalls[0]!.split(':').pop());
  const mainWidth = Number(strokeCalls[1]!.split(':').pop());
  assert.ok(outlineWidth > mainWidth);
  assert.equal(ctx.lineCap, 'round');
});

test('drawStrokesOnCanvas：坐标按自然尺寸缩放重放', () => {
  const { ctx, calls } = fakeCtx();
  drawStrokesOnCanvas(ctx, [{ points: [{ x: 0.5, y: 0.25 }, { x: 1, y: 1 }] }], 400, 200);
  assert.ok(calls.includes('moveTo(200,50)'));
  assert.ok(calls.includes('lineTo(400,200)'));
});

test('drawStrokesOnCanvas：空笔迹跳过不产生路径', () => {
  const { ctx, calls } = fakeCtx();
  drawStrokesOnCanvas(ctx, [{ points: [] }], 100, 100);
  assert.equal(calls.filter((c) => c === 'beginPath').length, 0);
});

test('annotatedFileName：原名-标注.<ext> 且幂等', () => {
  assert.equal(annotatedFileName('shot.png', '.png'), 'shot-标注.png');
  assert.equal(annotatedFileName('photo.jpeg', '.jpg'), 'photo-标注.jpg');
  assert.equal(annotatedFileName('截图 01.png', '.png'), '截图 01-标注.png');
  assert.equal(annotatedFileName('noext', '.png'), 'noext-标注.png');
  assert.equal(annotatedFileName('shot-标注.png', '.png'), 'shot-标注.png');
});
