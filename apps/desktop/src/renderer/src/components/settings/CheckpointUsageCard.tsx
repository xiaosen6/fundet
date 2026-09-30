/**
 * CheckpointUsageCard — 设置 → 通用 的快照磁盘占用卡。
 * 显示 checkpoints 目录总大小 + 一键清空（带确认弹窗）。
 * 0.3.30：用户实报 26GB 膨胀（孤儿仓+永不gc+依赖树全量入库）后补的可见性。
 */
import { useEffect, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/ConfirmDialog';

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function CheckpointUsageCard(): React.JSX.Element {
  const [bytes, setBytes] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  const refresh = (): void => {
    void window.fundet.checkpointDiskUsage().then((r) => setBytes(r.bytes));
  };

  useEffect(refresh, []);

  const purge = (): void => {
    void (async () => {
      const ok = await confirmDialog({
        title: '清空全部快照？',
        description: '所有会话的文件回滚历史将被删除（聊天记录不受影响），此操作不可撤销。',
        confirmText: '清空',
        danger: true,
      });
      if (!ok) return;
      setPurging(true);
      try {
        const r = await window.fundet.checkpointPurge();
        setBytes(r.bytes);
        toast.success(`快照已清空（当前占用 ${fmtBytes(r.bytes)}）`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '清空失败');
      } finally {
        setPurging(false);
      }
    })();
  };

  return (
    <div className="rounded-container border border-board bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <HardDrive size={14} className="text-secondary" />
        <span className="text-13 font-medium text-primary">文件快照空间</span>
        <span className="font-mono text-13 tabular-nums text-secondary">
          {bytes === null ? '…' : fmtBytes(bytes)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={purging || bytes === 0}
          onClick={purge}
          className="flex h-7 items-center gap-1.5 rounded-xl border border-board px-2.5 text-12 text-secondary hover:text-primary disabled:opacity-50"
        >
          <Trash2 size={12} /> {purging ? '清理中…' : '清空全部快照'}
        </button>
      </div>
      <p className="mt-1.5 text-11 leading-relaxed text-placeholder">
        每轮对话自动拍摄文件快照（用于回滚），仅存储在工作目录内有变更的文件。
        快照会自动清理孤儿数据（每会话最多保留 20 条，超出删最旧）。
        清空后不影响聊天记录，仅丢失文件回滚历史。
      </p>
    </div>
  );
}
