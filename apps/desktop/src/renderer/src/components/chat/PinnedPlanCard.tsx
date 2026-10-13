/**
 * PinnedPlanCard —— 消息会话右侧的常驻计划侧栏（用户拍板：计划卡在会话
 * **右侧**，与 Canvas 同级同结构挂 flex-row 右列；不在会话流里、不浮层
 * 遮挡——占宽度把消息列收窄，物理上不盖任何内容）。
 *
 * 数据：todo 工具增量确认重放出的最新清单快照（ChatPage 派生传入）。
 * 退场：①全部完成且轮次已结束 → 2 秒后自动收起（新计划重新出现）；
 * ②点 X 手动收起（同一份计划不再出现，AI 更新计划内容后视为新计划回归）。
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ListTodo, X } from 'lucide-react';
import type { TodoEntry } from '../../lib/todoList';

const DONE_LINGER_MS = 2_000;

export function PinnedPlanCard({
  entries,
  running,
}: {
  entries: readonly TodoEntry[];
  /** 当前轮是否仍在跑（全勾但仍在跑不收起——agent 收尾漏勾/自检是常态） */
  running: boolean;
}): React.JSX.Element | null {
  const identity = JSON.stringify(entries.map((e) => [e.id, e.text, e.done]));
  const [dismissedIdentity, setDismissedIdentity] = useState<string | null>(null);
  const [hiddenAfterDone, setHiddenAfterDone] = useState(false);

  // 新计划（内容变化）重置自动收起标记
  useEffect(() => {
    setHiddenAfterDone(false);
  }, [identity]);

  const allDone = entries.length > 0 && entries.every((e) => e.done);
  useEffect(() => {
    if (!allDone || running) return;
    const t = window.setTimeout(() => setHiddenAfterDone(true), DONE_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [allDone, running, identity]);

  if (entries.length === 0 || hiddenAfterDone || dismissedIdentity === identity) return null;

  const done = entries.filter((e) => e.done).length;
  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-board bg-surface">
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-board px-3">
        <ListTodo size={14} className="text-muted" />
        <span className="text-13 font-medium text-primary">计划清单</span>
        <span className="ml-auto text-11 tabular-nums text-muted">
          {done}/{entries.length}
        </span>
        <button
          type="button"
          aria-label="收起计划侧栏"
          onClick={() => setDismissedIdentity(identity)}
          className="shrink-0 rounded p-1 text-secondary transition-colors hover:bg-hover hover:text-primary"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
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
    </aside>
  );
}
