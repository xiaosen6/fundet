/**
 * PinnedPlanCard —— 会话区右上角常驻计划卡（用户拍板：计划不在会话流里
 * 渲染，固定右上角跟进进度；Cindy 的胶囊在 composer 上方居中且只在流内卡
 * 滚出视口时出现——位置与常驻性按用户偏好偏离）。
 *
 * 数据：todo 工具增量确认重放出的最新清单快照（ChatPage 派生传入）。
 * 退场：①全部完成且轮次已结束 → 2 秒后自动收起（新计划重新出现）；
 * ②点 X 手动收起（同一份计划不再出现，AI 更新计划内容后视为新计划回归）。
 */
import { useEffect, useState } from 'react';
import { TodoListCard } from '../TodoListCard';
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

  return (
    <div className="pointer-events-none absolute top-3 right-4 z-30 w-[300px]">
      <div className="pointer-events-auto shadow-[var(--shadow-menu)]">
        <TodoListCard entries={entries} onDismiss={() => setDismissedIdentity(identity)} />
      </div>
    </div>
  );
}
