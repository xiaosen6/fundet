/**
 * 自动化 cron 计算单测（零依赖纯函数，node --test 直跑）。
 * 覆盖六种触发类型 + 非法输入 + cron 五段语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRunAt } from './automation-schedule.ts';

const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);
const rule = (schedule: Parameters<typeof nextRunAt>[0]['schedule'], time: string | null = null, day: number | null = null, cron: string | null = null) =>
  ({ schedule, time, day, cron });

test('hourly：整点前进', () => {
  const next = nextRunAt(rule('hourly'), at(2026, 9, 21, 10, 30));
  const d = new Date(next!);
  assert.equal(d.getHours(), 11);
  assert.equal(d.getMinutes(), 0);
});

test('daily：今天已过则明天，未过则当天', () => {
  const d1 = new Date(nextRunAt(rule('daily', '09:00'), at(2026, 9, 21, 10, 0))!);
  assert.equal(d1.getDate(), 22);
  assert.equal(d1.getHours(), 9);
  const d2 = new Date(nextRunAt(rule('daily', '09:00'), at(2026, 9, 21, 8, 0))!);
  assert.equal(d2.getDate(), 21);
});

test('weekdays：跳过周末（周六 → 周一）', () => {
  const d = new Date(nextRunAt(rule('weekdays', '09:00'), at(2026, 9, 26, 10, 0))!);
  assert.ok(d.getDay() >= 1 && d.getDay() <= 5);
  assert.equal(d.getDate(), 28);
});

test('weekly：指定星期（周一 → 周三）', () => {
  const d = new Date(nextRunAt(rule('weekly', '09:00', 3), at(2026, 9, 21, 10, 0))!);
  assert.equal(d.getDay(), 3);
  assert.equal(d.getDate(), 23);
});

test('monthly：指定日期；2 月无 31 日跳 3/31', () => {
  const d1 = new Date(nextRunAt(rule('monthly', '09:00', 15), at(2026, 9, 20, 10, 0))!);
  assert.equal(d1.getDate(), 15);
  assert.equal(d1.getMonth(), 9);
  const d2 = new Date(nextRunAt(rule('monthly', '09:00', 31), at(2026, 2, 1, 10, 0))!);
  assert.equal(d2.getMonth(), 2);
  assert.equal(d2.getDate(), 31);
});

test('cron：工作日 9 点 / 每 15 分钟', () => {
  const d1 = new Date(nextRunAt(rule('cron', null, null, '0 9 * * 1-5'), at(2026, 9, 26, 10, 0))!);
  assert.equal(d1.getDay(), 1);
  assert.equal(d1.getHours(), 9);
  const d2 = new Date(nextRunAt(rule('cron', null, null, '*/15 * * * *'), at(2026, 9, 21, 10, 7))!);
  assert.equal(d2.getMinutes(), 15);
});

test('非法输入返回 null', () => {
  assert.equal(nextRunAt(rule('daily', '99:99'), at(2026, 9, 21)), null);
  assert.equal(nextRunAt(rule('cron', null, null, 'not a cron'), at(2026, 9, 21)), null);
  assert.equal(nextRunAt(rule('monthly', '09:00', 32), at(2026, 9, 21)), null);
});

test('interval：未跑过以 from 为锚；跑过以上次完成时间为锚', () => {
  // 未跑过（lastRunAt 空）：from + 30min
  const r1 = { schedule: 'interval' as const, time: null, day: null, cron: null, intervalMinutes: 30, lastRunAt: null };
  const d1 = new Date(nextRunAt(r1, at(2026, 9, 21, 10, 0))!);
  assert.equal(d1.getHours(), 10);
  assert.equal(d1.getMinutes(), 30);
  // 跑过（lastRunAt=10:00）：锚 + 30min = 10:30
  const r2 = { ...r1, lastRunAt: at(2026, 9, 21, 10, 0).getTime() };
  const d2 = new Date(nextRunAt(r2, at(2026, 9, 21, 10, 10))!);
  assert.equal(d2.getMinutes(), 30);
  // 停机久（锚已过）：立即触发（1 分钟后）
  const r3 = { ...r1, lastRunAt: at(2026, 9, 20, 10, 0).getTime() };
  const d3 = new Date(nextRunAt(r3, at(2026, 9, 21, 10, 0))!);
  assert.equal(d3.getHours(), 10);
  assert.equal(d3.getMinutes(), 1);
});

test('once：未跑到点触发；已跑（lastRunAt 非空）不再触发', () => {
  const r1 = { schedule: 'once' as const, time: '15:00', day: null, cron: null, lastRunAt: null };
  const d1 = new Date(nextRunAt(r1, at(2026, 9, 21, 10, 0))!);
  assert.equal(d1.getHours(), 15);
  // 已过 15:00 → 明天 15:00
  const d2 = new Date(nextRunAt(r1, at(2026, 9, 21, 16, 0))!);
  assert.equal(d2.getDate(), 22);
  // 已跑 → null
  const r2 = { ...r1, lastRunAt: at(2026, 9, 21, 15, 0).getTime() };
  assert.equal(nextRunAt(r2, at(2026, 9, 22, 10, 0)), null);
});
