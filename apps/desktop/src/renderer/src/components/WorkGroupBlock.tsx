/**
 * WorkGroupBlock —— 工作流聚合块（Cindy AgentActionsBlock v2 同款）：
 * 单行摘要头展开为左竖线行列表（AgentActionRow / ThinkingCard）。
 *
 * 状态机（Cindy F8/F9）：
 *   - 每个块**默认折叠**（含流式中的块），摘要实时聚合；用户手动展开。
 *   - 展开态按块记忆（模块级内存 store，应用运行期内跨会话切换保留，
 *     重启有意不持久化——持久化会让工具块开机即展开，很吵）。
 *   - 头部图标：块内有 running 行时 Bot 换 Spinner（同槽同尺寸零跳变）。
 *
 * 头部无卡片铬：Bot 14px + 聚合摘要 14px（「编辑 3 个文件、运行 2 条命令
 * 和读取 1 个文件」）+ 尾 chevron。展开体：pl-3 左 2px 竖线（rail）。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronRight, Loader2 } from 'lucide-react';
import type { DisplayItem } from '../stores/sessionStore';
import { cn } from '../lib/cn';
import { Collapse } from './ui/Collapse';
import { ThinkingCard } from './ThinkingCard';
import { aggregateVerbs, formatSummary, shortToolName } from '../lib/agent-actions/verbAggregator';
import { AgentActionRow } from './chat/AgentActionRow';

export type WorkChild = Extract<DisplayItem, { kind: 'thinking' } | { kind: 'tool' }>;

/** todo 工具（计划清单）独立渲染在时间线，不进工作组（用户拍板：计划卡要一直可见） */
export function isTodoToolItem(it: DisplayItem): boolean {
  return it.kind === 'tool' && shortToolName(it.toolName) === 'todo';
}

// ---------------------------------------------------------------------------
// 展开记忆（Cindy useExpandedBlockMemory 简版）：模块级 Map + 订阅广播，
// 应用运行期内保留（跨会话切换），重启有意清零。
// ---------------------------------------------------------------------------
const expandedStore = new Map<string, boolean>();
const expandedListeners = new Set<() => void>();

function useExpandedBlockMemory(blockId: string): { expanded: boolean; setExpanded: (next: boolean | ((prev: boolean) => boolean)) => void } {
  const [expanded, setExpandedState] = useState<boolean>(() => expandedStore.get(blockId) === true);
  useEffect(() => {
    setExpandedState(expandedStore.get(blockId) === true);
    const listener = (): void => setExpandedState(expandedStore.get(blockId) === true);
    expandedListeners.add(listener);
    return () => {
      expandedListeners.delete(listener);
    };
  }, [blockId]);
  const setExpanded = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(expandedStore.get(blockId) === true) : next;
      expandedStore.set(blockId, resolved);
      for (const l of expandedListeners) l();
    },
    [blockId],
  );
  return { expanded, setExpanded };
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
}): React.JSX.Element | null {
  // 稳定块 id：首条目 id 在流内唯一，token 流转中不漂移
  const blockId = `agent:${childrenItems[0]?.id ?? 'empty'}`;
  const { expanded, setExpanded } = useExpandedBlockMemory(blockId);

  // 摘要只聚合 tool 条目（thinking 不计入动词）；块内有运行中的行时头部换 spinner
  const toolItems = useMemo(() => childrenItems.filter((c): c is Extract<WorkChild, { kind: 'tool' }> => c.kind === 'tool'), [childrenItems]);
  const summaryText = useMemo(() => formatSummary(aggregateVerbs(toolItems.map((t) => t.toolName))), [toolItems]);
  const hasRunning = streaming && toolItems.some((t) => !t.done);

  if (childrenItems.length === 0) return null;

  return (
    <div className="flex w-full justify-start">
      <div className="w-full">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            'flex w-full cursor-pointer items-center gap-[6px] py-[2px]',
            'select-none text-left transition-opacity hover:opacity-80',
          )}
        >
          <span className="inline-flex h-[1lh] shrink-0 items-center">
            {hasRunning ? (
              <Loader2 size={14} className="animate-spin text-muted" />
            ) : (
              <Bot size={14} className="text-muted" />
            )}
          </span>
          <span className="min-w-0 translate-y-[1px] truncate text-14 text-secondary">
            {summaryText || '工作过程'}
          </span>
          <div className="flex-1" />
          <ChevronRight
            size={14}
            className={cn(
              'shrink-0 text-muted',
              'transition-transform duration-[var(--motion-fast,150ms)]',
              expanded && 'rotate-90',
            )}
          />
        </button>

        <Collapse open={expanded}>
          <div className="mt-1 flex flex-col border-l-2 border-board py-[2px] pl-3">
            {childrenItems.map((item) =>
              item.kind === 'thinking' ? (
                <ThinkingCard
                  key={item.id}
                  text={item.text}
                  running={item.running}
                  durationMs={item.durationMs}
                />
              ) : (
                <AgentActionRow
                  key={item.id}
                  item={item}
                  running={streaming && !item.done}
                  workDir={workDir}
                  onOpenFile={onOpenFile}
                />
              ),
            )}
          </div>
        </Collapse>
      </div>
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
    // todo（计划清单）独立成行渲染在时间线，不进工作组——计划卡不被
    // 折叠吞掉（用户拍板：一直可见）
    if (it.kind === 'tool' && isTodoToolItem(it)) {
      out.push(it);
      i += 1;
      continue;
    }
    if (it.kind === 'thinking' || it.kind === 'tool') {
      const children: WorkChild[] = [];
      while (
        i < items.length &&
        (items[i].kind === 'thinking' || (items[i].kind === 'tool' && !isTodoToolItem(items[i])))
      ) {
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
