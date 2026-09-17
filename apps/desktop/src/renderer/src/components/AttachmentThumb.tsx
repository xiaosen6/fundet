/**
 * AttachmentThumb —— 图片附件的 24×24 圆角缩略图（composer chip 与用户气泡共用）。
 *
 * 经 readFileDataUrl（deny-list 预览策略）读原图；非图片/读失败静默回落
 * FileText 图标，不阻断 chip 本身。大小上限由主进程 8MB 把关。
 */
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../lib/cn';
import { fileKind } from '../../../shared/file-kind.ts';

export function AttachmentThumb({ path, className }: { path: string; className?: string }): React.JSX.Element {
  const isImage = fileKind(path) === 'image';
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    window.fundet
      .readFileDataUrl(path, '')
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        /* 失败回落图标 */
      });
    return () => {
      alive = false;
    };
  }, [path, isImage]);

  if (!isImage) {
    return <FileText size={12} className={cn('shrink-0 text-muted', className)} aria-hidden />;
  }
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-board bg-chip',
        className,
      )}
      aria-hidden
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <FileText size={12} className="text-muted" />
      )}
    </span>
  );
}
