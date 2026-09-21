/**
 * 自动化（定时例行任务）类型——主/渲染共用。
 * 模型与 Cindy「自动化」对齐：触发器（每小时/每天/工作日/每周/每月/cron）+ 指令，
 * 到点在本机起一个隔离会话（auto- 前缀，不进侧栏）跑，结果进运行历史。
 */

export type AutomationSchedule = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron' | 'interval' | 'once';

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
  /** interval：上次运行完成后等 N 分钟 */
  intervalMinutes: number | null;
  /** 指定模型（空=默认 provider 首启用模型） */
  model: string | null;
  /** 指定 providerId（与 model 配对；空=默认） */
  providerId: string | null;
  instructions: string;
  workDir: string;
  status: 'active' | 'paused';
  nextRunAt: number | null;
  /** once：上次成功触发时间（用于一次性已跑标记） */
  lastRunAt: number | null;
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

/** 新建/编辑入参（id/status/nextRunAt/lastRunAt/createdAt 由主进程管） */
export type AutomationInput = Omit<AutomationView, 'id' | 'status' | 'nextRunAt' | 'lastRunAt' | 'createdAt'>;

/** 触发摘要（列表人话版：每天 09:00 / 每周一 09:00 / 每 30 分钟 / 一次） */
export function automationScheduleSummary(a: Pick<AutomationView, 'schedule' | 'time' | 'day' | 'intervalMinutes'>): string {
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
    case 'interval': {
      const m = a.intervalMinutes ?? 0;
      return m >= 60 && m % 60 === 0 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`;
    }
    case 'cron':
      return '自定义';
    case 'once':
      return `一次 ${t}`;
    default:
      return '';
  }
}
