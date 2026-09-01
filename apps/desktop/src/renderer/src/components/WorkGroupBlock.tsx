import { memo, useEffect, useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import type { DisplayItem } from '../stores/sessionStore';
import { cn } from '../lib/cn';
import { Collapse } from './ui/Collapse';
import { ThinkingCard, formatDuration } from './ThinkingCard';
import { ToolCallCard } from './ToolCallCard';

export type WorkChild = Extract<DisplayItem, { kind: 'thinking' } | { kind: 'tool' }>;

function workDurationMs(children: WorkChild[], streaming: boolean): number | undefined {
  const think = children
    .filter((c): c is Extract<WorkChild, { kind: 'thinking' }> => c.kind === 'thinking')
    .reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const times = children.map((c) => c.createdAt).filter((n): n is number => typeof n === 'number');
  const span =
    times.length >= 1
      ? Math.max(0, (streaming ? Date.now() : Math.max(...times)) - Math.min(...times))
      : 0;
  const ms = Math.max(think, span);
  return ms > 0 ? ms : undefined;
}

// groupWorkItems 每次 items 变化都会新建 children 数组（元素引用不变），默认浅比较
// 恒不等；按元素逐项比较引用，历史工作组在流式期间不再重渲染。
function workGroupPropsEqual(
  prev: { childrenItems: WorkChild[]; streaming: boolean; workDir?: string; onOpenFile?: (path: string) => void },
  next: { childrenItems: WorkChild[]; streaming: boolean; workDir?: string; onOpenFile?: (path: string) => void },
): boolean {
  return (
    prev.streaming === next.streaming &&
    prev.workDir === next.workDir &&
    prev.onOpenFile === next.onOpenFile &&
    prev.childrenItems.length === next.childrenItems.length &&
    prev.childrenItems.every((c, i) => c === next.childrenItems[i])
  );
}

function WorkGroupBlockImpl({
  childrenItems,
  streaming,
  workDir,
  onOpenFile,
}: {
  childrenItems: WorkChild[];
  streaming: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(streaming);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (streaming) setExpanded(true);
    else setExpanded(false);
  }, [streaming]);

  useEffect(() => {
    if (!streaming) return;
    const start = Math.min(
      ...childrenItems.map((c) => c.createdAt).filter((n): n is number => typeof n === 'number'),
      Date.now(),
    );
    const tick = (): void => setElapsed(Math.max(0, Date.now() - start));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [streaming, childrenItems]);

  const durationMs = workDurationMs(childrenItems, streaming);
  const label = streaming
    ? '工作中'
    : durationMs !== undefined
      ? `已工作 ${formatDuration(durationMs)}`
      : '工作过程';

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-[6px] py-[2px]',
          'cursor-pointer text-left select-none',
          'transition-opacity hover:opacity-80',
        )}
      >
        <span className="inline-flex h-[1lh] shrink-0 items-center">
          <Layers size={14} className="text-secondary" />
        </span>
        <span className="min-w-0 translate-y-[1px] truncate text-14 text-secondary">{label}</span>
        <div className="flex-1" />
        {streaming && elapsed > 0 && (
          <span className="font-mono text-12 text-secondary">{formatDuration(elapsed)}</span>
        )}
        <ChevronRight
          size={14}
          className={cn(
            'shrink-0 text-secondary',
            'transition-transform duration-[var(--motion-fast,150ms)]',
            expanded && 'rotate-90',
          )}
        />
      </button>
      <Collapse open={expanded}>
        <div className="mt-1 flex flex-col gap-2">
          {childrenItems.map((item) =>
            item.kind === 'thinking' ? (
              <ThinkingCard
                key={item.id}
                text={item.text}
                running={item.running}
                durationMs={item.durationMs}
              />
            ) : (
              <ToolCallCard
                key={item.id}
                toolName={item.toolName}
                input={item.input}
                resultText={item.resultText}
                isError={item.isError}
                done={item.done}
                workDir={workDir}
                onOpenFile={onOpenFile}
              />
            ),
          )}
        </div>
      </Collapse>
    </div>
  );
}

export const WorkGroupBlock = memo(WorkGroupBlockImpl, workGroupPropsEqual);

export function groupWorkItems(
  items: DisplayItem[],
  isRunning: boolean,
): Array<DisplayItem | { kind: 'work_group'; id: string; children: WorkChild[]; streaming: boolean }> {
  const out: Array<DisplayItem | { kind: 'work_group'; id: string; children: WorkChild[]; streaming: boolean }> =
    [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind === 'thinking' || it.kind === 'tool') {
      const children: WorkChild[] = [];
      while (i < items.length && (items[i].kind === 'thinking' || items[i].kind === 'tool')) {
        children.push(items[i] as WorkChild);
        i += 1;
      }
      const trailing = i === items.length && isRunning;
      out.push({
        kind: 'work_group',
        id: `work-${children[0]?.id ?? i}`,
        children,
        streaming: trailing,
      });
      continue;
    }
    out.push(it);
    i += 1;
  }
  return out;
}
