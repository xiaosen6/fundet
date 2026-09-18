/**
 * RewindDialog —— 会话文件回滚对话框（Cindy RewindPreviewDialog 的 Fundet 版）。
 * 列出该会话的快照（每轮发送前自动落）→ 选中后预览将恢复/删除的文件 →
 * 确认执行（执行前自动落「回滚前快照」，可再回滚回来）。git 不可用时列表
 * 恒空，入口按钮隐藏在 ChatPage 侧判断。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileMinus2, FileOutput, History, Loader2 } from 'lucide-react';
import type { CheckpointInfo, RewindPreview } from '../../../shared/fundet-api.js';
import { cn } from '../lib/cn';
import { useReducedMotion } from '../hooks/useReducedMotion';

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

export function RewindDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [list, setList] = useState<CheckpointInfo[] | null>(null);
  const [selected, setSelected] = useState<CheckpointInfo | null>(null);
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.fundet
      .listCheckpoints(sessionId)
      .then((l) => setList(l))
      .catch((err: unknown) => {
        setList([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [applying, onClose]);

  const select = (cp: CheckpointInfo): void => {
    setSelected(cp);
    setPreview(null);
    setError('');
    setPreviewing(true);
    void window.fundet
      .previewRewind(sessionId, cp.sha)
      .then(setPreview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPreviewing(false));
  };

  const apply = (): void => {
    if (!selected || applying) return;
    setApplying(true);
    setError('');
    void window.fundet
      .rewindTo(sessionId, selected.sha)
      .then((result) => {
        const n = result.restore.length + result.remove.length;
        onClose();
        void import('./ui/toast').then(({ toast }) =>
          toast.success(`已回滚 ${n} 个文件（回滚前已自动快照，可再次回滚撤销）`),
        );
      })
      .catch((err: unknown) => {
        setApplying(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const changedCount = preview ? preview.restore.length + preview.remove.length : 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="关闭"
        className={cn('absolute inset-0 bg-[var(--overlay-modal)]', !reducedMotion && 'animate-[confirm-overlay-in_160ms_ease-out]')}
        onClick={() => !applying && onClose()}
      />
      <div
        className={cn(
          'relative z-10 flex max-h-[80vh] w-[560px] max-w-[calc(100vw-48px)] flex-col rounded-container border border-board bg-card p-5',
          !reducedMotion && 'animate-[confirm-card-in_160ms_ease-out]',
        )}
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-secondary" />
          <p className="text-15 font-medium text-primary">回滚工作目录文件</p>
        </div>
        <p className="mt-1 text-12 leading-relaxed text-muted">
          每轮对话发送前都会自动快照工作目录。选一个时点，把文件恢复到那时——
          对话内容不变，只回滚文件。执行前会先快照当前状态（可再回滚回来）。
        </p>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-inner border border-board">
          {list === null ? (
            <div className="flex h-24 items-center justify-center text-13 text-muted">读取快照…</div>
          ) : list.length === 0 ? (
            <div className="flex h-24 items-center justify-center px-4 text-center text-13 text-muted">
              {error || '还没有快照（发过一轮消息后自动产生；需要本机装有 Git）'}
            </div>
          ) : (
            list.map((cp) => (
              <button
                key={cp.sha}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                  selected?.sha === cp.sha ? 'bg-hover' : 'hover:bg-hover-soft',
                )}
                onClick={() => select(cp)}
              >
                <span className="w-[86px] shrink-0 text-12 tabular-nums text-muted">{formatWhen(cp.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-13 text-primary">{cp.label}</span>
                <span className="shrink-0 font-mono text-10 text-muted">{cp.sha.slice(0, 7)}</span>
              </button>
            ))
          )}
        </div>

        {selected && (
          <div className="mt-3 rounded-inner border border-board bg-surface p-3">
            <p className="text-12 font-medium text-secondary">
              {previewing ? '正在计算差异…' : changedCount === 0 ? '与当前文件无差异' : `将改动 ${changedCount} 个文件`}
            </p>
            {preview && (
              <div className="mt-1.5 max-h-32 overflow-y-auto">
                {preview.restore.slice(0, 50).map((p) => (
                  <p key={p} className="flex items-center gap-1.5 truncate text-12 text-secondary" title={p}>
                    <FileOutput size={11} className="shrink-0" aria-hidden /> {basename(p)}
                  </p>
                ))}
                {preview.remove.slice(0, 50).map((p) => (
                  <p key={p} className="flex items-center gap-1.5 truncate text-12 text-error" title={p}>
                    <FileMinus2 size={11} className="shrink-0" aria-hidden /> {basename(p)}
                  </p>
                ))}
                {changedCount > 50 && <p className="text-11 text-muted">…共 {changedCount} 项</p>}
              </div>
            )}
          </div>
        )}

        {error && !applying && <p className="mt-2 text-12 text-error">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-full border border-board px-4 text-13 text-secondary hover:bg-hover"
            onClick={() => !applying && onClose()}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selected || previewing || changedCount === 0 || applying}
            className="flex h-9 items-center gap-1.5 rounded-full bg-error px-4 text-13 font-medium text-white disabled:opacity-40"
            onClick={apply}
          >
            {applying ? <Loader2 size={13} className="animate-fundet-spin" /> : null}
            {applying ? '正在回滚…' : '回滚文件'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
