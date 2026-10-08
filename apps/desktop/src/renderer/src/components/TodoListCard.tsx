/**
 * TodoListCard —— todo 工具结果的待办清单卡（替代普通工具文本卡）。
 * 数据源：官方 todo 扩展的 list 输出（lib/todoList.ts 解析）。
 */
import { CheckCircle2, Circle, ListTodo } from 'lucide-react';
import { parseTodoList } from '../lib/todoList';

interface TodoListCardProps {
  resultText?: string;
}

export function TodoListCard({ resultText }: TodoListCardProps): React.JSX.Element | null {
  const todos = parseTodoList(resultText);
  if (!todos) return null;
  const done = todos.filter((t) => t.done).length;
  return (
    <div className="rounded-container border border-board bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <ListTodo size={14} className="text-muted" />
        <span className="text-13 font-medium text-primary">待办清单</span>
        <span className="ml-auto text-11 tabular-nums text-muted">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {todos.map((t) => (
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
