import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStartupBounds } from './window-bounds.ts';

const requested = { x: 80, y: 80, width: 1280, height: 800 };
const minimum = { width: 960, height: 640 };

test('1366×768 矮工作区：窗口完整落在工作区内', () => {
  const workArea = { x: 0, y: 0, width: 1366, height: 728 };
  const { bounds } = fitStartupBounds(requested, workArea, minimum);
  assert.equal(bounds.height, 728);
  assert.equal(bounds.y, 0);
  assert.equal(bounds.y + bounds.height <= workArea.height, true);
});

test('工作区恰好等于默认尺寸：不改变默认矩形', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 800 };
  assert.deepEqual(fitStartupBounds(requested, workArea, minimum).bounds, { x: 0, y: 0, width: 1280, height: 800 });
});

test('负坐标副屏：x/y 与右下角都留在该屏', () => {
  const workArea = { x: -1280, y: 100, width: 1280, height: 680 };
  const { bounds } = fitStartupBounds(requested, workArea, minimum);
  assert.equal(bounds.x, -1280);
  assert.equal(bounds.y, 100);
  assert.equal(bounds.x + bounds.width <= workArea.x + workArea.width, true);
  assert.equal(bounds.y + bounds.height <= workArea.y + workArea.height, true);
});

test('工作区小于最小尺寸：最小值同步收缩，不让 BrowserWindow 再撑出界', () => {
  const workArea = { x: 20, y: 20, width: 700, height: 500 };
  const out = fitStartupBounds(requested, workArea, minimum);
  assert.deepEqual(out.bounds, { x: 20, y: 20, width: 700, height: 500 });
  assert.equal(out.minWidth, 700);
  assert.equal(out.minHeight, 500);
});
