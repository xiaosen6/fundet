import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_COLORS,
  annotatedFileName,
  arrowHeadLength,
  arrowHeadWings,
  clearAnnotations,
  clamp01,
  clampPoint,
  drawAnnotationOp,
  emptyAnnotationHistory,
  isOpMeaningful,
  normalizeRect,
  pathLength,
  pushAnnotationOp,
  redoAnnotationOp,
  replayAnnotationOps,
  strokeWidthPx,
  textFontPx,
  undoAnnotationOp,
  type AnnotationHistoryState,
  type AnnotationOp,
  type AnnotationReplayCtx,
} from './annotation.ts';

function recorderCtx(): { ctx: AnnotationReplayCtx; calls: (string | number)[][]; props: Record<string, unknown> } {
  const calls: (string | number)[][] = [];
  const props: Record<string, unknown> = {};
  const rec = (name: string) => (...args: (string | number)[]) => calls.push([name, ...args]);
  const ctx = {
    get strokeStyle() {
      return props.strokeStyle;
    },
    set strokeStyle(v: unknown) {
      props.strokeStyle = v;
    },
    get fillStyle() {
      return props.fillStyle;
    },
    set fillStyle(v: unknown) {
      props.fillStyle = v;
    },
    get lineWidth() {
      return props.lineWidth as number;
    },
    set lineWidth(v: number) {
      props.lineWidth = v;
    },
    get lineJoin() {
      return props.lineJoin;
    },
    set lineJoin(v: unknown) {
      props.lineJoin = v;
    },
    get lineCap() {
      return props.lineCap;
    },
    set lineCap(v: unknown) {
      props.lineCap = v;
    },
    get font() {
      return props.font;
    },
    set font(v: unknown) {
      props.font = v;
    },
    get textBaseline() {
      return props.textBaseline;
    },
    set textBaseline(v: unknown) {
      props.textBaseline = v;
    },
    get textAlign() {
      return props.textAlign;
    },
    set textAlign(v: unknown) {
      props.textAlign = v;
    },
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    strokeRect: rec('strokeRect'),
    fillText: rec('fillText'),
  };
  return { ctx: ctx as unknown as AnnotationReplayCtx, calls, props };
}

const RED = ANNOTATION_COLORS.red;

test('clamp01 / clampPoint 夹取到 [0,1]', () => {
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(0.42), 0.42);
  assert.deepEqual(clampPoint({ x: -1, y: 2 }), { x: 0, y: 1 });
});

test('normalizeRect 支持反向拖拽', () => {
  assert.deepEqual(normalizeRect({ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.4 }), {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.2,
  });
  // 从右下往左上拖：起点终点互换归一
  assert.deepEqual(normalizeRect({ x: 0.6, y: 0.4 }, { x: 0.1, y: 0.2 }), {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.2,
  });
  assert.deepEqual(normalizeRect({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }), {
    x: 0.3,
    y: 0.3,
    width: 0,
    height: 0,
  });
});

test('pathLength 求折线长度', () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([{ x: 0, y: 0 }]), 0);
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 0.3, y: 0.4 }]), 0.5);
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 0.3, y: 0.4 }, { x: 0.3, y: 0.4 }]), 0.5);
});

test('strokeWidthPx：小图原值、大图按最长边等比放大', () => {
  assert.equal(strokeWidthPx(800, 600, 4), 4);
  assert.equal(strokeWidthPx(1000, 1000, 2), 2);
  assert.equal(strokeWidthPx(3000, 2000, 4), 12); // 4 * 3
  assert.equal(strokeWidthPx(2000, 4000, 2), 8); // 取最长边 4000 → 2 * 4
});

test('textFontPx 钳 16..72', () => {
  assert.equal(textFontPx(400), 16); // 12 → 钳到 16
  assert.equal(textFontPx(2000), 60); // 0.03 * 2000
  assert.equal(textFontPx(4000), 72); // 120 → 钳到 72
});

test('arrowHeadWings / arrowHeadLength 几何', () => {
  assert.equal(arrowHeadLength(4), 14);
  // 水平箭头 (0,0)→(10,0)，head=10：翼端点在尖端后方 ±24°
  const [w1, w2] = arrowHeadWings({ x: 0, y: 0 }, { x: 10, y: 0 }, 10);
  const cos24 = Math.cos((24 * Math.PI) / 180);
  const sin24 = Math.sin((24 * Math.PI) / 180);
  assert.ok(Math.abs(w1.x - (10 - 10 * cos24)) < 1e-9);
  assert.ok(Math.abs(w1.y - 10 * sin24) < 1e-9);
  assert.ok(Math.abs(w2.x - (10 - 10 * cos24)) < 1e-9);
  assert.ok(Math.abs(w2.y - -10 * sin24) < 1e-9);
  // 垂直向下箭头 (0,0)→(0,5)
  const [v1, v2] = arrowHeadWings({ x: 0, y: 0 }, { x: 0, y: 5 }, 10);
  assert.ok(Math.abs(v1.x - -10 * sin24) < 1e-9);
  assert.ok(Math.abs(v1.y - (5 - 10 * cos24)) < 1e-9);
  assert.ok(Math.abs(v2.x - 10 * sin24) < 1e-9);
  assert.ok(Math.abs(v2.y - (5 - 10 * cos24)) < 1e-9);
});

test('annotatedFileName：原名-标注.png 且幂等', () => {
  assert.equal(annotatedFileName('shot.png'), 'shot-标注.png');
  assert.equal(annotatedFileName('photo.jpeg'), 'photo-标注.png');
  assert.equal(annotatedFileName('截图 01.png'), '截图 01-标注.png');
  assert.equal(annotatedFileName('noext'), 'noext-标注.png');
  assert.equal(annotatedFileName('shot-标注.png'), 'shot-标注.png'); // 重复编辑不叠加
});

test('isOpMeaningful 过滤误触与空文本', () => {
  const tinyRect: AnnotationOp = { type: 'rect', color: RED, width: 2, x1: 0.5, y1: 0.5, x2: 0.505, y2: 0.503 };
  assert.equal(isOpMeaningful(tinyRect), false);
  const rect: AnnotationOp = { type: 'rect', color: RED, width: 2, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.4 };
  assert.equal(isOpMeaningful(rect), true);
  const clickArrow: AnnotationOp = { type: 'arrow', color: RED, width: 4, x1: 0.5, y1: 0.5, x2: 0.502, y2: 0.5 };
  assert.equal(isOpMeaningful(clickArrow), false);
  const tapPen: AnnotationOp = { type: 'pen', color: RED, width: 2, points: [{ x: 0.5, y: 0.5 }] };
  assert.equal(isOpMeaningful(tapPen), false);
  const pen: AnnotationOp = {
    type: 'pen',
    color: RED,
    width: 2,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
  };
  assert.equal(isOpMeaningful(pen), true);
  assert.equal(isOpMeaningful({ type: 'text', color: RED, x: 0.1, y: 0.1, size: 0.03, text: '   ' }), false);
  assert.equal(isOpMeaningful({ type: 'text', color: RED, x: 0.1, y: 0.1, size: 0.03, text: '看这里' }), true);
});

test('撤销/重做栈：push 清空 redo、undo/redo 往返、clear 复位', () => {
  const opA: AnnotationOp = { type: 'rect', color: RED, width: 2, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.4 };
  const opB: AnnotationOp = { type: 'text', color: RED, x: 0.2, y: 0.2, size: 0.03, text: 'A' };

  let h: AnnotationHistoryState = emptyAnnotationHistory;
  assert.deepEqual(h, { ops: [], redo: [] });
  assert.equal(h.ops.length, 0);

  h = pushAnnotationOp(h, opA);
  assert.equal(h.ops.length, 1);
  // 无意义操作不入栈
  h = pushAnnotationOp(h, { type: 'rect', color: RED, width: 2, x1: 0.5, y1: 0.5, x2: 0.501, y2: 0.501 });
  assert.equal(h.ops.length, 1);

  h = undoAnnotationOp(h);
  assert.deepEqual(h, { ops: [], redo: [opA] });
  // redo 后再 push 新操作 → redo 清空
  h = redoAnnotationOp(h);
  assert.deepEqual(h, { ops: [opA], redo: [] });
  h = undoAnnotationOp(h);
  h = pushAnnotationOp(h, opB);
  assert.deepEqual(h, { ops: [opB], redo: [] });

  h = pushAnnotationOp(h, opA);
  h = clearAnnotations(h);
  assert.deepEqual(h, emptyAnnotationHistory);
  // 空栈 undo/redo 原样返回
  assert.equal(undoAnnotationOp(emptyAnnotationHistory), emptyAnnotationHistory);
  assert.equal(redoAnnotationOp(emptyAnnotationHistory), emptyAnnotationHistory);
});

test('replay 矩形：归一化坐标 → 自然分辨率像素', () => {
  const { ctx, calls, props } = recorderCtx();
  replayAnnotationOps(ctx, [{ type: 'rect', color: RED, width: 4, x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.4 }], 200, 100);
  assert.deepEqual(calls, [['strokeRect', 20, 20, 100, 20]]);
  assert.equal(props.strokeStyle, RED);
  assert.equal(props.lineWidth, 4); // 200px 小图不放大
  assert.equal(props.lineJoin, 'round');
  assert.equal(props.lineCap, 'round');
});

test('replay 矩形：反向拖拽 + 大图线宽放大', () => {
  const { ctx, calls, props } = recorderCtx();
  replayAnnotationOps(ctx, [{ type: 'rect', color: RED, width: 2, x1: 0.6, y1: 0.4, x2: 0.1, y2: 0.2 }], 2000, 1000);
  assert.deepEqual(calls, [['strokeRect', 200, 200, 1000, 200]]);
  assert.equal(props.lineWidth, 4); // 2 * 2000/1000
});

test('replay 箭头：主干 + 两翼按线宽自适应', () => {
  const { ctx, calls, props } = recorderCtx();
  replayAnnotationOps(ctx, [{ type: 'arrow', color: RED, width: 2, x1: 0, y1: 0, x2: 0.5, y2: 0 }], 200, 100);
  const head = arrowHeadLength(2);
  const cos24 = Math.cos((24 * Math.PI) / 180);
  const sin24 = Math.sin((24 * Math.PI) / 180);
  assert.deepEqual(calls, [
    ['beginPath'],
    ['moveTo', 0, 0],
    ['lineTo', 100, 0],
    ['moveTo', 100, 0],
    ['lineTo', 100 - head * cos24, head * sin24],
    ['moveTo', 100, 0],
    ['lineTo', 100 - head * cos24, -head * sin24],
    ['stroke'],
  ]);
  assert.equal(props.lineWidth, 2);
});

test('replay 画笔：点序列映射 + 单点安全', () => {
  const { ctx, calls } = recorderCtx();
  replayAnnotationOps(
    ctx,
    [
      {
        type: 'pen',
        color: RED,
        width: 2,
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
      },
    ],
    200,
    100,
  );
  assert.deepEqual(calls, [
    ['beginPath'],
    ['moveTo', 0, 0],
    ['lineTo', 100, 50],
    ['lineTo', 200, 100],
    ['stroke'],
  ]);
  const single = recorderCtx();
  drawAnnotationOp(single.ctx, { type: 'pen', color: RED, width: 2, points: [{ x: 0.5, y: 0.5 }] }, 200, 100);
  assert.deepEqual(single.calls, [['beginPath'], ['moveTo', 100, 50], ['stroke']]);
});

test('replay 文字：字号 = size × 最长边，top/left 锚点，下限 10px', () => {
  const { ctx, calls, props } = recorderCtx();
  replayAnnotationOps(ctx, [{ type: 'text', color: RED, x: 0.1, y: 0.1, size: 0.04, text: '看这里' }], 400, 200);
  assert.deepEqual(calls, [['fillText', '看这里', 40, 20]]);
  assert.equal(props.font, "600 16px Inter, 'Microsoft YaHei', sans-serif");
  assert.equal(props.fillStyle, RED);
  assert.equal(props.textBaseline, 'top');
  assert.equal(props.textAlign, 'left');
  // 小图上的小字号落下限，防止烧录后小到不可读
  const tiny = recorderCtx();
  drawAnnotationOp(tiny.ctx, { type: 'text', color: RED, x: 0, y: 0, size: 0.01, text: 'x' }, 200, 100);
  assert.match(String(tiny.props.font), /600 10px /);
});

test('replay 多操作按序重放', () => {
  const { ctx, calls } = recorderCtx();
  replayAnnotationOps(
    ctx,
    [
      { type: 'rect', color: RED, width: 2, x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      { type: 'arrow', color: ANNOTATION_COLORS.blue, width: 2, x1: 0, y1: 0, x2: 1, y2: 0 },
    ],
    100,
    100,
  );
  assert.equal(calls[0]?.[0], 'strokeRect');
  assert.equal(calls[1]?.[0], 'beginPath');
  assert.equal(calls[calls.length - 1]?.[0], 'stroke');
});
