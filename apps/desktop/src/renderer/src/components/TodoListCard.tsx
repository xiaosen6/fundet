/**
 * TodoListCard —— 计划/待办清单卡（Cindy InlinePlanCard 同位）。
 * 数据源：todo 工具输出的重放快照（lib/todoList.ts replayTodoSnapshots，
 * 增量确认「Added todo #N」/「Todo #N completed」按序重建的清单状态）。
 */
import { CheckCircle2, Circle, ListTodo, X } from 'lucide-react';
import type { TodoEntry } from '../lib/todoList';

interface TodoListCardProps {
  entries: readonly TodoEntry[];
  /** 提供时头行右侧显示关闭钮（右上角常驻卡用） */
  onDismiss?: () => void;
}

export function TodoListCard({ entries, onDismiss }: TodoListCardProps): React.JSX.Element | null {
  if (entries.length === 0) return null;
  const done = entries.filter((t) => t.done).length;
  return (
    <div className="rounded-container border border-board bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <ListTodo size={14} className="text-muted" />
        <span className="text-13 font-medium text-primary">计划清单</span>
        <span className="ml-auto text-11 tabular-nums text-muted">
          {done}/{entries.length}
        </span>
        {onDismiss && (
          <button
            type="button"
            aria-label="收起计划卡"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-hover hover:text-primary"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {entries.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            {t.done ? (
              <CheckCircle2 size={15} className="mt-px shrink-0 text-accent" />
            ) : (
              <Circle size={15} className="mt-px shrink-0 text-muted" />
            )}
            <span
              className={
                t.done
                  ? 'min-w-0 break-words text-13 text-muted line-through'
                  : 'min-w-0 break-words text-13 text-primary'
              }
            >
              {t.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
