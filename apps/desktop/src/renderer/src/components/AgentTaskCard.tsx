/**
 * AgentTaskCard — 子 agent 任务进度卡（agent_task_update 事件的可视化，对齐
 * Cindy AgentTaskCard 的轻量版）。rail 风格：状态图标 + 标题 + 模型徽标 +
 * 摘要行。事件不落库，历史重建后不回放（与 thinking 直播卡同口径的取舍）。
 */
import { CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import type { DisplayItem } from '../stores/sessionStore';

type TaskItem = Extract<DisplayItem, { kind: 'task' }>;

const STATUS_META: Record<TaskItem['status'], { Icon: typeof Loader2; cls: string; label: string }> = {
  running: { Icon: Loader2, cls: 'text-secondary animate-spin', label: '进行中' },
  completed: { Icon: CheckCircle2, cls: 'text-success', label: '已完成' },
  failed: { Icon: XCircle, cls: 'text-error', label: '失败' },
  stopped: { Icon: MinusCircle, cls: 'text-muted', label: '已停止' },
};

export function AgentTaskCard({ item }: { item: TaskItem }): React.JSX.Element {
  const { Icon, cls, label } = STATUS_META[item.status];
  const detail = item.summary || item.description || '';
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-inner border px-3 py-2',
        item.status === 'failed' ? 'border-error-border bg-error-bg/40' : 'border-board bg-card',
      )}
    >
      <Icon size={14} className={cn('mt-[2px] shrink-0', cls)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-13 font-medium text-primary">{item.title || '子任务'}</span>
          {item.model ? (
            <span className="shrink-0 rounded-full bg-chip px-1.5 py-px text-10 text-muted">{item.model}</span>
          ) : null}
          <span className={cn('shrink-0 text-11', item.status === 'failed' ? 'text-error' : 'text-muted')}>{label}</span>
        </div>
        {detail ? (
          <p className="mt-0.5 line-clamp-2 text-12 leading-[1.5] text-secondary">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
