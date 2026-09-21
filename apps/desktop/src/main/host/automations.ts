/**
 * 自动化（定时例行任务）宿主：cron 计算 + 调度器 + 发送管线。
 *
 * 设计（对齐 Cindy 自动化，宿主直发而非插件沙箱）：
 * - 纯函数 nextRunAt（本地时区；weekly=day 0-6，monthly=day 1-31，cron=五段）；
 * - 调度器每 30s tick：找 nextRunAt<=now 的 active 任务起隔离会话跑；
 * - 启动补偿：上次到本次之间漏跑的只补跑一次（按最近一次 nextRunAt 触发）；
 * - 会话 id = auto-<runId>（隔离，不进侧栏列表）；运行结束标记 run 状态。
 *
 * 可注入（单测直跑 cron/调度 tick）：sendFn = (instructions, workDir) => Promise<sessionId>。
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.ts';
import { automations, automationRuns } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import type { AutomationInput, AutomationView, AutomationRunView } from '../../shared/automations.ts';

import { nextRunAt } from './automation-schedule.ts';
/* ---------------- 视图转换 ---------------- */

type Row = typeof automations.$inferSelect;
function toView(r: Row): AutomationView {
  return {
    id: r.id,
    name: r.name,
    schedule: r.schedule as AutomationView['schedule'],
    time: r.time,
    day: r.day,
    cron: r.cron,
    intervalMinutes: r.intervalMinutes,
    model: r.model,
    providerId: r.providerId,
    instructions: r.instructions,
    workDir: r.workDir,
    status: r.status as AutomationView['status'],
    nextRunAt: r.nextRunAt,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt,
  };
}

/* ---------------- 注入依赖 ---------------- */

export interface AutomationDeps {
  /** 起隔离会话并发指令；返回会话 id（auto- 前缀） */
  sendFn: (input: { instructions: string; workDir: string; sessionId: string; model: string | null; providerId: string | null }) => Promise<void>;
  now: () => number;
}

const defaultDeps: AutomationDeps = {
  sendFn: async () => {
    throw new Error('automation sendFn not wired');
  },
  now: () => Date.now(),
};
let deps: AutomationDeps = defaultDeps;
/** 单测注入 */
export function setAutomationDeps(d: Partial<AutomationDeps>): void {
  deps = { ...deps, ...d };
}

/* ---------------- CRUD ---------------- */

export function listAutomations(): AutomationView[] {
  const rows = getDb().select().from(automations).all();
  return rows.map(toView).sort((a, b) => b.createdAt - a.createdAt);
}

export function createAutomation(input: AutomationInput): AutomationView {
  const now = deps.now();
  const id = randomUUID();
  const first = nextRunAt(input, new Date(now));
  getDb()
    .insert(automations)
    .values({
      id,
      name: input.name.trim() || input.instructions.slice(0, 20),
      schedule: input.schedule,
      time: input.time,
      day: input.day,
      cron: input.cron,
      intervalMinutes: input.intervalMinutes,
      model: input.model,
      providerId: input.providerId,
      instructions: input.instructions,
      workDir: input.workDir,
      status: 'active',
      nextRunAt: first,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return toView(getDb().select().from(automations).where(eq(automations.id, id)).get()!);
}

export function updateAutomation(id: string, input: AutomationInput): AutomationView | null {
  const row = getDb().select().from(automations).where(eq(automations.id, id)).get();
  if (!row) return null;
  const next = row.status === 'active' ? nextRunAt({ ...input, lastRunAt: row.lastRunAt }, new Date(deps.now())) : row.nextRunAt;
  getDb()
    .update(automations)
    .set({
      name: input.name.trim() || input.instructions.slice(0, 20),
      schedule: input.schedule,
      time: input.time,
      day: input.day,
      cron: input.cron,
      intervalMinutes: input.intervalMinutes,
      model: input.model,
      providerId: input.providerId,
      instructions: input.instructions,
      workDir: input.workDir,
      nextRunAt: next,
      updatedAt: deps.now(),
    })
    .where(eq(automations.id, id))
    .run();
  return toView(getDb().select().from(automations).where(eq(automations.id, id)).get()!);
}

export function deleteAutomation(id: string): void {
  getDb().delete(automations).where(eq(automations.id, id)).run();
}

export function setAutomationPaused(id: string, paused: boolean): void {
  const row = getDb().select().from(automations).where(eq(automations.id, id)).get();
  if (!row) return;
  const now = deps.now();
  const next = paused ? row.nextRunAt : nextRunAt(row as AutomationView, new Date(now));
  getDb()
    .update(automations)
    .set({ status: paused ? 'paused' : 'active', nextRunAt: next, updatedAt: now })
    .where(eq(automations.id, id))
    .run();
}

export function listAutomationRuns(automationId: string, limit = 20): AutomationRunView[] {
  return getDb()
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      automationId: r.automationId,
      sessionId: r.sessionId,
      status: r.status as AutomationRunView['status'],
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      error: r.error,
    }));
}

/* ---------------- 调度器 ---------------- */

const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;

/** 执行一次触发（可被 tick 与 runNow 共用） */
async function fireAutomation(id: string): Promise<void> {
  if (running.has(id)) return;
  const row = getDb().select().from(automations).where(eq(automations.id, id)).get();
  if (!row) return;
  running.add(id);
  const runId = randomUUID();
  const sessionId = `auto-${runId}`;
  const now = deps.now();
  getDb()
    .insert(automationRuns)
    .values({
      id: runId,
      automationId: id,
      sessionId,
      status: 'running',
      startedAt: now,
      endedAt: null,
      error: null,
      createdAt: now,
    })
    .run();
  // 触发后立即算下一次（interval 以 now 为新锚；once 已触发则 nextRunAt=null）
  const next = nextRunAt({ ...(row as AutomationView), lastRunAt: row.schedule === 'once' ? now : row.lastRunAt }, new Date(now));
  getDb()
    .update(automations)
    .set({ nextRunAt: next, lastRunAt: row.schedule === 'once' ? now : row.lastRunAt, updatedAt: now })
    .where(eq(automations.id, id))
    .run();
  try {
    await deps.sendFn({ instructions: row.instructions, workDir: row.workDir, sessionId, model: row.model, providerId: row.providerId });
    getDb()
      .update(automationRuns)
      .set({ status: 'success', endedAt: deps.now() })
      .where(eq(automationRuns.id, runId))
      .run();
  } catch (err) {
    getDb()
      .update(automationRuns)
      .set({ status: 'failed', endedAt: deps.now(), error: err instanceof Error ? err.message : String(err) })
      .where(eq(automationRuns.id, runId))
      .run();
  } finally {
    running.delete(id);
  }
}

export function runAutomationNow(id: string): void {
  void fireAutomation(id);
}

/** 一次 tick：把到期的 active 任务各触发一次（返回触发数，单测断言用） */
export function automationTick(nowMs: number = deps.now()): number {
  const due = getDb()
    .select()
    .from(automations)
    .all()
    .filter((r) => r.status === 'active' && r.nextRunAt !== null && r.nextRunAt <= nowMs);
  for (const r of due) void fireAutomation(r.id);
  return due.length;
}

/** 启动补偿：上次到启动间漏跑的 active 任务，各补跑一次（按最近一次 nextRunAt） */
export function catchupMissed(nowMs: number = deps.now()): number {
  return automationTick(nowMs);
}

export function startAutomationScheduler(): void {
  if (timer) return;
  catchupMissed();
  timer = setInterval(() => {
    try {
      automationTick();
    } catch (err) {
      console.warn('[fundet:automations] tick 失败', err);
    }
  }, 30_000);
}

export function stopAutomationScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
