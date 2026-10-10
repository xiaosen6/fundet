/**
 * TurnChangesBar —— 轮末改动卡（对齐 Cindy TurnChangesCard 卡片形态）。
 * 最新一轮任务完成后出现在 composer 上方：头部（FileDiff 图标盒 + 「已更改 N
 * 个文件」+ +/- 总数 + 黄色提示行 + 右侧撤销/重新应用按钮），下方文件行
 * （图标 + 相对路径 + 右侧行数），默认 3 条 + 「再显示 N 个」展开。数据来自
 * checkpoint 快照 numstat（仅最新一轮，不持久化）。撤销 = checkpoint 回滚到
 * 轮前快照 baseSha（先自动落 pre-rollback 快照，之后按钮翻转为「重新应用」，
 * 回滚到该快照即恢复本轮改动）。Cindy 的「审查」按钮依赖其右侧栏审查面板
 * 体系，Fundet 无此体系未移植；点文件仍打开 Canvas 预览。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, FileDiff, FileText, Loader2, Redo2, Undo2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { confirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/toast';

const MAX_VISIBLE_FILES = 3;

export interface TurnChangeEntry {
  path: string;
  additions: number;
  deletions: number;
}

export function TurnChangesBar({
  sessionId,
  files,
  baseSha,
  onOpenFile,
}: {
  sessionId: string;
  files: TurnChangeEntry[];
  /** 轮前快照 sha（撤销目标）；null=本轮无可回滚基准（如首轮未落快照），隐藏撤销按钮 */
  baseSha: string | null;
  onOpenFile: (path: string) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  // 撤销后翻转为「重新应用」：undo 落的 pre-rollback 快照即本轮改动后的工作区态
  const [undone, setUndone] = useState(false);
  const [reapplySha, setReapplySha] = useState<string | null>(null);

  // 新一轮改动到来时复位（收起 + 回到未撤销态）
  useEffect(() => {
    setExpanded(false);
    setUndone(false);
    setReapplySha(null);
  }, [files]);

  if (files.length === 0) return null;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const visibleFiles = expanded ? files : files.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = files.length - visibleFiles.length;

  const applyRewind = async (): Promise<void> => {
    if (applying) return;
    const wasUndone = undone;
    const targetSha = wasUndone ? reapplySha : baseSha;
    if (!targetSha) return;
    const ok = await confirmDialog({
      title: wasUndone ? '重新应用本轮文件改动？' : '撤销本轮文件改动？',
      description: wasUndone
        ? '将把工作目录恢复到撤销前的状态（本轮改动后的时点）。执行前会先自动快照当前状态，可再回滚回来。'
        : `将把工作目录恢复到本轮开始前的状态（涉及 ${files.length} 个文件）；本轮之后手动改过的文件也会被还原。执行前会先自动快照当前状态，可再回滚回来。`,
      confirmText: wasUndone ? '重新应用' : '撤销',
    });
    if (!ok) return;
    setApplying(true);
    try {
      const result = await window.fundet.rewindTo(sessionId, targetSha);
      const n = result.restore.length + result.remove.length;
      if (wasUndone) {
        setUndone(false);
        toast.success('已重新应用本轮文件改动');
      } else {
        setUndone(true);
        setReapplySha(result.preRollbackSha);
        toast.success(`已撤销本轮改动（恢复 ${n} 个文件）`);
      }
    } catch (err) {
      toast.error(`${wasUndone ? '重新应用' : '撤销'}失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="fundet-surface mx-auto w-full max-w-[820px] overflow-hidden rounded-container border border-board bg-card">
      <div className="flex min-h-16 items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-inner bg-chip text-secondary">
          <FileDiff size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-14 font-medium text-primary">已更改 {files.length} 个文件</div>
          <div className="mt-0.5 font-mono text-12 tabular-nums">
            <span className="text-diff-add-fg">+{additions}</span>{' '}
            <span className="text-diff-del-fg">-{deletions}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-11 text-warning">
            <AlertTriangle size={12} />
            <span>仅撤销或重新应用已精确记录的变更；未记录的改动不会由此操作处理</span>
          </div>
        </div>
        {baseSha && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={applying || (undone && !reapplySha)}
              title={undone && !reapplySha ? '撤销时未留下快照，无法重新应用' : undefined}
              aria-label={undone ? '重新应用本轮文件改动' : '撤销本轮文件改动'}
              onClick={() => void applyRewind()}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-inner px-2 text-13 font-medium',
                'text-primary transition-colors hover:bg-hover',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {applying ? (
                <Loader2 size={15} className="animate-fundet-spin" />
              ) : undone ? (
                <Redo2 size={15} />
              ) : (
                <Undo2 size={15} />
              )}
              {undone ? '重新应用' : '撤销'}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-board px-3 py-2">
        {visibleFiles.map((f) => (
          <button
            key={f.path}
            type="button"
            title={f.path}
            onClick={() => onOpenFile(f.path)}
            className="flex h-9 w-full items-center gap-2 rounded-inner px-2 text-left transition-colors hover:bg-hover"
          >
            <FileText size={15} className="shrink-0 text-secondary" />
            <span className="min-w-0 flex-1 truncate text-13 text-primary">{f.path}</span>
            <span className="shrink-0 whitespace-nowrap font-mono text-12 tabular-nums">
              {f.additions > 0 && <span className="text-diff-add-fg">+{f.additions}</span>}{' '}
              {f.deletions > 0 && <span className="text-diff-del-fg">-{f.deletions}</span>}
            </span>
          </button>
        ))}
        {!expanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn(
              'flex h-8 items-center gap-1 rounded-inner px-2 text-13 text-secondary',
              'transition-colors hover:bg-hover hover:text-primary',
            )}
          >
            再显示 {hiddenCount} 个文件
            <ChevronDown size={14} />
          </button>
        )}
        {expanded && files.length > MAX_VISIBLE_FILES && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={cn(
              'flex h-8 items-center gap-1 rounded-inner px-2 text-13 text-secondary',
              'transition-colors hover:bg-hover hover:text-primary',
            )}
          >
            收起
            <ChevronUp size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
