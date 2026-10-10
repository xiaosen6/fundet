/**
 * messageNavRailModel 纯逻辑单测（Cindy 同名测试的 node --test 移植版，
 * 测试即规格书）：条目派生过滤 / 当前提问判定 / 空间与截断规划。
 * 无 DOM（组件侧几何测量不在此覆盖，见 MessageNavRail.tsx 注释）。
 * Fundet 适配：fixture 从 Cindy ChatMessage 换成 DisplayItem；Cindy 的
 * steer 插话 / 合成续跑 / hook 消息封装 / 空闲补页（Fundet 无分页）无对应
 * 概念，未移植。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NAV_RAIL_ACTIVE_FUDGE_PX,
  NAV_RAIL_EXCERPT_MAX_CHARS,
  NAV_RAIL_JUMP_TOP_OFFSET_PX,
  NAV_RAIL_MIN_GUTTER_PX,
  NAV_RAIL_TICK_MIN_PITCH_PX,
  NAV_RAIL_TICK_PITCH_PX,
  deriveNavRailEntries,
  hasNavRailRoom,
  normalizeExcerpt,
  pickActiveNavId,
  pickVisibleNavRange,
  planNavRailTicks,
  planNavRailTickWidth,
  planNavRailTickProgress,
  promptPreviewLine,
} from './messageNavRailModel.ts';
import { forwardNavRailWheel } from './messageNavRailWheel.ts';
import type { DisplayItem } from '../../stores/sessionStore';
import type { SessionAttachment } from '../../../../shared/fundet-api.js';

const user = (id: string, text: string, attachments?: SessionAttachment[]): DisplayItem => ({
  kind: 'user',
  id,
  text,
  ...(attachments ? { attachments } : {}),
});
const assistant = (id: string, text: string): DisplayItem => ({ kind: 'assistant', id, text });
const thinking = (id: string, text: string): DisplayItem => ({
  kind: 'thinking',
  id,
  text,
  running: false,
});
const toolRow = (id: string): DisplayItem => ({
  kind: 'tool',
  id,
  toolName: 'bash',
  input: {},
  done: true,
});
const taskRow = (id: string): DisplayItem => ({
  kind: 'task',
  id,
  taskId: 't-1',
  title: '子任务',
  status: 'running',
});
const errorRow = (id: string): DisplayItem => ({ kind: 'error', id, message: '失败' });
const noticeRow = (id: string, text: string): DisplayItem => ({ kind: 'notice', id, text });

// ── deriveNavRailEntries ────────────────────────────────────────────────────

test('deriveNavRailEntries：只收真实用户提问，跳过 assistant / thinking / tool / task / error / notice 行', () => {
  const items: DisplayItem[] = [
    user('u1', '第一问'),
    assistant('a1', '回答'),
    toolRow('t1'),
    errorRow('e1'),
    noticeRow('n1', '已停止'),
    taskRow('k1'),
    user('u4', '第二问\n补充'),
  ];
  const entries = deriveNavRailEntries(items);
  assert.deepEqual(entries.map((e) => e.id), ['u1', 'u4']);
  assert.equal(entries[1]?.preview, '第二问');
});

test('deriveNavRailEntries：空输入返回空数组', () => {
  assert.deepEqual(deriveNavRailEntries([]), []);
});

test('deriveNavRailEntries：无文本也无附件的 user 消息不产生刻度', () => {
  const items: DisplayItem[] = [
    user('u1', ''),
    user('u2', '   \n  '),
    user('u3', '真提问'),
  ];
  assert.deepEqual(
    deriveNavRailEntries(items).map((e) => e.id),
    ['u3'],
  );
});

test('deriveNavRailEntries：纯附件提问预览用附件名，不丢刻度', () => {
  const entries = deriveNavRailEntries([
    user('u1', '', [{ path: '/tmp/需求文档.pdf', name: '需求文档.pdf', kind: 'file' }]),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.preview, '需求文档.pdf');
});

test('deriveNavRailEntries：纯附件且取不到文件名（无名附件）保留刻度，记 attachmentsOnly 数量', () => {
  const entries = deriveNavRailEntries([
    user('u1', '', [
      { path: '/tmp/shot.png', name: '', kind: 'image' },
      { path: '/tmp/shot2.png', name: '', kind: 'image' },
    ]),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.preview, '');
  assert.equal(entries[0]?.attachmentsOnly, 2);
});

test('deriveNavRailEntries：回答摘要取该轮最后一条非空 assistant 正文，跳过 thinking / tool 行', () => {
  const items: DisplayItem[] = [
    user('u1', '第一问'),
    thinking('th1', '推理过程'),
    toolRow('t1'),
    assistant('a1', '  我先看下\n项目结构  '),
    assistant('a2', '结论:入口在右键,不在 0 尺寸节点。'),
    user('u2', '第二问(流式中,尚无回答)'),
  ];
  const entries = deriveNavRailEntries(items);
  assert.equal(entries[0]?.answerExcerpt, '结论:入口在右键,不在 0 尺寸节点。');
  assert.equal(entries[1]?.answerExcerpt, undefined);
});

test('deriveNavRailEntries：开工叙述会被同轮最终回答覆盖', () => {
  const entries = deriveNavRailEntries([
    user('u1', '这个点不到吧'),
    assistant('a1', '对，那个 0 尺寸节点不是给人点的，只是拿来锚菜单。我先核对它会不会一打开就被关掉。'),
    assistant('a2', '对，那个 0 尺寸节点本身点不到。\n\n它不是入口。入口是定时器按钮的右键。'),
  ]);
  assert.equal(
    entries[0]?.answerExcerpt,
    '对，那个 0 尺寸节点本身点不到。 它不是入口。入口是定时器按钮的右键。',
  );
});

test('deriveNavRailEntries：提问之前的 assistant 消息不会挂到任何条目上', () => {
  const entries = deriveNavRailEntries([assistant('a0', '开场白'), user('u1', '第一问')]);
  assert.equal(entries[0]?.answerExcerpt, undefined);
});

test('deriveNavRailEntries：全空白的 assistant 正文不占用摘要名额', () => {
  const entries = deriveNavRailEntries([
    user('u1', '第一问'),
    assistant('a1', '   \n  '),
    assistant('a2', '真正的回答'),
  ]);
  assert.equal(entries[0]?.answerExcerpt, '真正的回答');
});

test('deriveNavRailEntries：规范化后为空的尾条不冲掉已有有效摘要', () => {
  const entries = deriveNavRailEntries([
    user('u1', '第一问'),
    assistant('a1', '真正的回答'),
    assistant('a2', '<!-- hidden -->\n`**`'),
  ]);
  assert.equal(entries[0]?.answerExcerpt, '真正的回答');
});

test('deriveNavRailEntries：error / notice 行不占用回答摘要', () => {
  const entries = deriveNavRailEntries([
    user('u1', '第一问'),
    assistant('a1', '真正的回答'),
    errorRow('e1'),
    noticeRow('n1', '已停止'),
  ]);
  assert.equal(entries[0]?.answerExcerpt, '真正的回答');
});

// ── promptPreviewLine ───────────────────────────────────────────────────────

test('promptPreviewLine：引用消息优先取引用块之外用户自己的话', () => {
  const content = ['> 被引用的一段回答文字', '', '这个没必要吧,没必要就不要提了'].join('\n');
  assert.equal(promptPreviewLine(content), '这个没必要吧,没必要就不要提了');
});

test('promptPreviewLine：全引用消息退回引用文字本身，去掉引用前缀', () => {
  const content = ['> 被引用的一段回答文字'].join('\n');
  assert.equal(promptPreviewLine(content), '被引用的一段回答文字');
});

test('promptPreviewLine：普通多行提问取首个非空行', () => {
  assert.equal(promptPreviewLine('\n第一行\n第二行'), '第一行');
});

// ── normalizeExcerpt ────────────────────────────────────────────────────────

test('normalizeExcerpt：压平换行与连续空白成单行', () => {
  assert.equal(normalizeExcerpt('第一行\n\n  第二行\t结尾 '), '第一行 第二行 结尾');
});

test('normalizeExcerpt：剥常见 Markdown 标记（粗体 / 行内代码 / 标题 / 引用 / 列表符 / 链接）', () => {
  assert.equal(
    normalizeExcerpt(
      '## 结论\n**触发条件(现状)**:≥ **4 条**提问\n- 用 `onLoadMore` 补页\n> 引用行\n详见 [设计文档](https://example.com/spec)。',
    ),
    '结论 触发条件(现状):≥ 4 条提问 用 onLoadMore 补页 引用行 详见 设计文档。',
  );
});

test('normalizeExcerpt：行首负号数字不是列表符，不剥', () => {
  assert.equal(normalizeExcerpt('-5度 是正文'), '-5度 是正文');
});

test('normalizeExcerpt：截断到摘要上限', () => {
  assert.equal(normalizeExcerpt('长'.repeat(500)).length, NAV_RAIL_EXCERPT_MAX_CHARS);
});

// ── 跳转落点与当前项阈值的约束关系 ──────────────────────────────────────────

test('阈值必须大于落点偏移 — 跳转落定后目标自身即成为当前项', () => {
  assert.ok(NAV_RAIL_ACTIVE_FUDGE_PX > NAV_RAIL_JUMP_TOP_OFFSET_PX);
});

// ── pickActiveNavId ─────────────────────────────────────────────────────────

test('pickActiveNavId：取最后一条顶边已越过阈值线的提问', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const tops = [-500, 40, 300, 900];
  assert.equal(pickActiveNavId(ids, 100, (i) => tops[i]!), 'u2');
});

test('pickActiveNavId：窗口外上方（null）视作已越过阈值', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const tops: Array<number | null> = [null, null, null, 900];
  assert.equal(pickActiveNavId(ids, 100, (i) => tops[i]!), 'u3');
});

test('pickActiveNavId：窗口外下方（+∞，Fundet 居中窗口适配）不算已越过', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const tops = [-500, 40, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  assert.equal(pickActiveNavId(ids, 100, (i) => tops[i]!), 'u2');
});

test('pickActiveNavId：全部都在阈值线之下时当前项为第一条', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const tops = [150, 400, 800, 1200];
  assert.equal(pickActiveNavId(ids, 100, (i) => tops[i]!), 'u1');
});

test('pickActiveNavId：恰好压线（等于阈值）算已越过 — 跳转落定后目标自身即当前项', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const tops = [-200, 100, 500, 900];
  assert.equal(pickActiveNavId(ids, 100, (i) => tops[i]!), 'u2');
});

test('pickActiveNavId：空列表返回 null', () => {
  assert.equal(pickActiveNavId([], 100, () => null), null);
});

test('pickActiveNavId：二分查找千级条目单次判定只测 O(log n) 个锚点', () => {
  const n = 1024;
  const bigIds = Array.from({ length: n }, (_, i) => `u${i}`);
  let touched = 0;
  const active = pickActiveNavId(bigIds, 100, (i) => {
    touched += 1;
    return i * 100;
  });
  assert.equal(active, 'u1'); // 顶边 100 恰好压线
  assert.ok(touched <= Math.ceil(Math.log2(n)) + 2);
});

// ── pickVisibleNavRange ─────────────────────────────────────────────────────

test('pickVisibleNavRange：视口横跨两轮，两轮都在范围里', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.deepEqual(rangeOf([-500, -100, 200, 900], 0, 700), { startIndex: 1, endIndex: 2 });
});

test('pickVisibleNavRange：视口整体落在单轮内部，范围收敛为这一轮', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.deepEqual(rangeOf([-500, -100, 900, 1500], 0, 700), { startIndex: 1, endIndex: 1 });
});

test('pickVisibleNavRange：贴底阅读最后一轮，范围 = 最后一条', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.deepEqual(rangeOf([-900, -600, -300, -50], 0, 700), { startIndex: 3, endIndex: 3 });
});

test('pickVisibleNavRange：窗口外上方（null）的轮次内容在视口上方，其自身可跨进视口', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.deepEqual(rangeOf([null, null, 400, 900], 0, 700), { startIndex: 1, endIndex: 2 });
});

test('pickVisibleNavRange：窗口外下方（+∞）不进可见范围', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.deepEqual(
    rangeOf([-500, -100, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], 0, 700),
    { startIndex: 1, endIndex: 1 },
  );
});

test('pickVisibleNavRange：视口在第一条提问之前返回 null', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  assert.equal(rangeOf([500, 900, 1300, 1700], 0, 400), null);
});

test('pickVisibleNavRange：回归——视口顶只剩上一轮的空白余量（顶边按容差抬高）则上一轮不亮', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];
  const rangeOf = (tops: Array<number | null>, viewTop: number, viewBottom: number) =>
    pickVisibleNavRange(ids, viewTop, viewBottom, (i) => tops[i]!);
  // 当前轮顶边在视口顶下方 ~30px，那 30px 全是消息间距/落点偏移的空白，
  // 上一轮却被点亮；顶边抬高 NAV_RAIL_ACTIVE_FUDGE_PX（40）后 30 < 40 出局。
  assert.deepEqual(rangeOf([-800, -300, 30, 900], 0 + NAV_RAIL_ACTIVE_FUDGE_PX, 700), {
    startIndex: 2,
    endIndex: 2,
  });
  // 反例：当前轮顶边压过阈值线（60 > 40），上一轮的正文确实还在屏上 → 亮。
  assert.deepEqual(rangeOf([-800, -300, 60, 900], 0 + NAV_RAIL_ACTIVE_FUDGE_PX, 700), {
    startIndex: 1,
    endIndex: 2,
  });
});

test('pickVisibleNavRange：空列表返回 null', () => {
  assert.equal(pickVisibleNavRange([], 0, 700, () => null), null);
});

// ── planNavRailTicks ────────────────────────────────────────────────────────

test('planNavRailTicks：空间充裕时标准纵距全量展示', () => {
  const plan = planNavRailTicks(10, 10 * NAV_RAIL_TICK_PITCH_PX);
  assert.deepEqual(plan, { startIndex: 0, pitchPx: NAV_RAIL_TICK_PITCH_PX, hiddenCount: 0 });
});

test('planNavRailTicks：略挤时压缩纵距但不截断', () => {
  const plan = planNavRailTicks(20, 20 * 7);
  assert.equal(plan.startIndex, 0);
  assert.equal(plan.hiddenCount, 0);
  assert.equal(plan.pitchPx, 7);
  assert.ok(plan.pitchPx >= NAV_RAIL_TICK_MIN_PITCH_PX);
});

test('planNavRailTicks：最小纵距也放不下时截掉最早的一段，预留占位刻度', () => {
  const availableHeight = 100; // 最小纵距 5px → 20 格，留 1 格占位 → 展示 19 条
  const plan = planNavRailTicks(50, availableHeight);
  assert.equal(plan.pitchPx, NAV_RAIL_TICK_MIN_PITCH_PX);
  assert.equal(plan.hiddenCount, 50 - 19);
  assert.equal(plan.startIndex, plan.hiddenCount);
  // 展示条数 + 占位 1 格不超过可用空间
  assert.ok((50 - plan.startIndex + 1) * plan.pitchPx <= availableHeight);
});

test('planNavRailTicks：零条目 / 零空间不炸', () => {
  assert.equal(planNavRailTicks(0, 500).hiddenCount, 0);
  assert.equal(planNavRailTicks(10, 0).hiddenCount, 0);
});

// ── planNavRailTickWidth / planNavRailTickProgress ──────────────────────────

test('planNavRailTickWidth：所有状态共享同一条 26px 轨道', () => {
  assert.equal(planNavRailTickWidth({ distance: 0, isActive: false, inView: false }), 'w-[26px]');
  assert.equal(planNavRailTickWidth({ distance: 1, isActive: false, inView: false }), 'w-[26px]');
  assert.equal(planNavRailTickWidth({ distance: 2, isActive: false, inView: false }), 'w-[26px]');
  assert.equal(planNavRailTickWidth({ distance: null, isActive: true, inView: true }), 'w-[26px]');
  assert.equal(
    planNavRailTickWidth({ distance: null, isActive: false, inView: false, isAutomation: true }),
    'w-[26px]',
  );
});

test('planNavRailTickProgress：交互进度按目标及邻居距离衰减', () => {
  assert.deepEqual([null, 0, 1, 2, 3, 4].map(planNavRailTickProgress), [0, 1, 0.7, 0.4, 0.2, 0]);
});

// ── hasNavRailRoom ──────────────────────────────────────────────────────────

test('hasNavRailRoom：内容列两侧留白足够才有空间', () => {
  // 容器 880 + 两侧各 44 = 968 恰好够
  assert.equal(hasNavRailRoom(880 + NAV_RAIL_MIN_GUTTER_PX * 2, 880), true);
  assert.equal(hasNavRailRoom(880 + NAV_RAIL_MIN_GUTTER_PX * 2 - 1, 880), false);
});

test('hasNavRailRoom：容器比内容列 maxWidth 还窄时没有空间', () => {
  assert.equal(hasNavRailRoom(600, 880), false);
  assert.equal(hasNavRailRoom(0, 880), false);
});

// ── forwardNavRailWheel ─────────────────────────────────────────────────────

test('forwardNavRailWheel：把 wheel 增量原样转发给滚动容器（横竖两轴）', () => {
  const calls: ScrollToOptions[] = [];
  forwardNavRailWheel({ scrollBy: (options) => calls.push(options) }, { deltaX: 3, deltaY: -120 });
  assert.deepEqual(calls, [{ left: 3, top: -120 }]);
});

test('forwardNavRailWheel：滚动容器缺席（卸载竞态）时静默不抛', () => {
  assert.doesNotThrow(() => forwardNavRailWheel(null, { deltaX: 0, deltaY: 10 }));
});
