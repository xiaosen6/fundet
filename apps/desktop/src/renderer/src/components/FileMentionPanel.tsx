/**
 * FileMentionPanel —— composer 里「@ 文件引用」的候选面板（Cindy AtMentionPanel
 * 的轻量移植：textarea 形态下不做行内 chip，选中即 stage 成附件 chip）。
 *
 * 数据由 useDirEntries 持有（键盘导航需要拿到高亮项），本组件纯展示；
 * 布局对齐 SlashPalette（输入卡上方浮层）；目录排前、文件按名排序。
 */
import { useEffect, useRef, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { cn } from '../lib/cn';
import type { DirEntry } from '../../../shared/fundet-api.js';

/** 候选上限：面板可滚，截断保持轻快 */
const MAX_ROWS = 30;

/** 列目录（fail-closed：读不了返回 error，不静默空表） */
export function useDirEntries(baseDir: string | null): { entries: DirEntry[] | null; error: string | null } {
  const state = useRef<{ entries: DirEntry[] | null; error: string | null }>({ entries: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!baseDir) return;
    let alive = true;
    state.current = { entries: null, error: null };
    setTick((n) => n + 1);
    window.fundet
      .listDir(baseDir)
      .then((list) => {
        if (alive) {
          state.current = { entries: list, error: null };
          setTick((n) => n + 1);
        }
      })
      .catch((err) => {
        if (alive) {
          state.current = { entries: null, error: err instanceof Error ? err.message : String(err) };
          setTick((n) => n + 1);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDir]);
  void tick;
  return state.current;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileMentionPanel({
  entries,
  error,
  filter,
  activeIndex,
  onHover,
  onPickDir,
  onPickFile,
}: {
  entries: DirEntry[] | null;
  error: string | null;
  filter: string;
  activeIndex: number;
  onHover: (i: number) => void;
  onPickDir: (name: string) => void;
  onPickFile: (entry: DirEntry) => void;
}): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement | null>(null);
  const filtered = (entries ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
  const visible = filtered.slice(0, MAX_ROWS);
  const active = Math.min(activeIndex, Math.max(visible.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-mention-index="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active]);

  let body: React.ReactNode;
  if (error) {
    body = <div className="px-3 py-2 text-12 text-muted">读不了目录：{error}</div>;
  } else if (!entries) {
    body = <div className="px-3 py-2 text-12 text-muted">正在读目录…</div>;
  } else if (visible.length === 0) {
    body = <div className="px-3 py-2 text-12 text-muted">没有匹配的文件</div>;
  } else {
    body = (
      <>
        {visible.map((e, i) => (
          <button
            key={e.name}
            type="button"
            data-mention-index={i}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-left',
              i === active ? 'bg-hover' : 'hover:bg-hover-soft',
            )}
            onMouseEnter={() => onHover(i)}
            onClick={() => (e.isDir ? onPickDir(e.name) : onPickFile(e))}
          >
            {e.isDir ? (
              <Folder size={14} className="shrink-0 text-muted" />
            ) : (
              <File size={14} className="shrink-0 text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-13 text-primary">{e.name}</span>
            {e.isDir ? (
              <span className="shrink-0 text-11 text-muted">目录</span>
            ) : (
              e.size > 0 && <span className="shrink-0 text-11 text-muted tabular-nums">{formatSize(e.size)}</span>
            )}
          </button>
        ))}
        {filtered.length > MAX_ROWS && (
          <div className="px-3 py-1 text-11 text-muted select-none">还有 {filtered.length - MAX_ROWS} 项，继续输入过滤…</div>
        )}
      </>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[240px] overflow-y-auto rounded-container border border-board bg-card py-1 animate-float-in">
      {body}
    </div>
  );
}
