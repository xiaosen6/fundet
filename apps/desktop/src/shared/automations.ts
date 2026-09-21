/**
 * 自动化（定时例行任务）类型——主/渲染共用。
 * 模型与 Cindy「自动化」对齐：触发器（每小时/每天/工作日/每周/每月/cron）+ 指令，
 * 到点在本机起一个隔离会话（auto- 前缀，不进侧栏）跑，结果进运行历史。
 */

export type AutomationSchedule = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron';

export interface AutomationView {
  id: string;
  name: string;
  schedule: AutomationSchedule;
  /** daily/weekly/monthly 的 HH:MM（本地时区） */
  time: string | null;
  /** weekly 0-6（0=周日）；monthly 1-31 */
  day: number | null;
  /** cron 表达式（schedule=cron 时） */
  cron: string | null;
  instructions: string;
  workDir: string;
  status: 'active' | 'paused';
  nextRunAt: number | null;
  createdAt: number;
}

export interface AutomationRunView {
  id: string;
  automationId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
}

/** 新建/编辑入参（id/status/nextRunAt 由主进程管） */
export type AutomationInput = Omit<AutomationView, 'id' | 'status' | 'nextRunAt' | 'createdAt'>;

/** 触发摘要（列表人话版：每天 09:00 / 每周一 09:00 / 每小时） */
export function automationScheduleSummary(a: Pick<AutomationView, 'schedule' | 'time' | 'day'>): string {
  const t = a.time ?? '';
  switch (a.schedule) {
    case 'hourly':
      return '每小时';
    case 'daily':
      return `每天 ${t}`;
    case 'weekdays':
      return `工作日 ${t}`;
    case 'weekly':
      return `每周${['日', '一', '二', '三', '四', '五', '六'][a.day ?? 0]} ${t}`;
    case 'monthly':
      return `每月 ${a.day} 日 ${t}`;
    case 'cron':
      return '自定义';
    default:
      return '';
  }
}
