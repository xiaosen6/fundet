import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SCALE,
  MIN_SCALE,
  RESET_VIEW,
  clampScale,
  clampTranslation,
  panView,
  wheelFactor,
  zoomAtPoint,
} from './lightboxGestures.ts';

const bounds = { width: 1000, height: 600 };

test('clampScale：0.2x~8x 之外夹回边界', () => {
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(99), MAX_SCALE);
  assert.equal(clampScale(1), 1);
});

test('zoomAtPoint：视口中心缩放只改 scale，平移保持 0', () => {
  const v = zoomAtPoint(1, { tx: 0, ty: 0 }, { x: 500, y: 300 }, 2, bounds);
  assert.deepEqual(v, { scale: 2, tx: 0, ty: 0 });
});

test('zoomAtPoint：光标下的内容点缩放前后不动', () => {
  const v = zoomAtPoint(2, { tx: 100, ty: -50 }, { x: 750, y: 300 }, 1.1, bounds);
  const cx = (750 - 500 - 100) / 2;
  const cy = (300 - 300 + 50) / 2;
  assert.equal(cx * v.scale + v.tx, 750 - 500);
  assert.equal(cy * v.scale + v.ty, 300 - 300);
});

test('zoomAtPoint：缩放/平移后 clamp 图片中心至少留在视口内', () => {
  const v = zoomAtPoint(1, { tx: 0, ty: 0 }, { x: 0, y: 0 }, 8, bounds);
  assert.equal(v.scale, MAX_SCALE);
  assert.equal(v.tx, bounds.width / 2);
  assert.equal(v.ty, bounds.height / 2);
});

test('zoomAtPoint：缩回 <=1x 时平移归零、居中', () => {
  const v = zoomAtPoint(2, { tx: 400, ty: -200 }, { x: 100, y: 100 }, 0.4, bounds);
  assert.deepEqual(v, { scale: 0.8, tx: 0, ty: 0 });
});

test('zoomAtPoint：从 <1x 放大越过 1x 仍以光标为锚', () => {
  const v = zoomAtPoint(0.5, { tx: 0, ty: 0 }, { x: 600, y: 350 }, 4, bounds);
  assert.equal(v.scale, 2);
  const cx = (600 - 500) / 0.5;
  const cy = (350 - 300) / 0.5;
  assert.equal(cx * v.scale + v.tx, 600 - 500);
  assert.equal(cy * v.scale + v.ty, 350 - 300);
});

test('clampTranslation：|tx|<=w/2 且 |ty|<=h/2', () => {
  assert.deepEqual(clampTranslation(-10000, 10000, bounds), { tx: -500, ty: 300 });
  assert.deepEqual(clampTranslation(30, -40, bounds), { tx: 30, ty: -40 });
});

test('panView：>1x 平移 clamp 中心入视口；<=1x 不可平移、回正', () => {
  assert.deepEqual(panView(2, 1000, -1000, bounds), { scale: 2, tx: 500, ty: -300 });
  assert.deepEqual(panView(1, 120, 80, bounds), { scale: 1, tx: 0, ty: 0 });
  assert.deepEqual(panView(0.5, 120, 80, bounds), { scale: 0.5, tx: 0, ty: 0 });
});

test('wheelFactor：滚轮一格 ±10%，deltaMode=1 按行换算', () => {
  assert.ok(Math.abs(wheelFactor(-100) - 1.1) < 1e-9);
  assert.ok(Math.abs(wheelFactor(100) - 1 / 1.1) < 1e-9);
  // 行模式一格 deltaY=3，×33px/行 ≈ 99px，落在一格 ±1% 内
  assert.ok(Math.abs(wheelFactor(-3, 1) - 1.1) < 0.01);
  assert.equal(wheelFactor(0), 1);
});

test('RESET_VIEW：1x 居中', () => {
  assert.deepEqual(RESET_VIEW, { scale: 1, tx: 0, ty: 0 });
});
