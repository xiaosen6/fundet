/**
 * AttachmentThumb —— 图片附件的 24×24 圆角缩略图（composer chip 与用户气泡共用）。
 *
 * 经 readFileDataUrl（deny-list 预览策略）读原图；非图片/读失败静默回落
 * FileText 图标，不阻断 chip 本身。大小上限由主进程 8MB 把关。
 * 传 onAnnotate 时悬停缩略图显示「标注」小按钮（仅 composer 未发送附件使用）。
 */
import { useEffect, useState } from 'react';
import { FileText, PenLine } from 'lucide-react';
import { cn } from '../lib/cn';
import { fileKind } from '../../../shared/file-kind.ts';

export function AttachmentThumb({
  path,
  className,
  onAnnotate,
}: {
  path: string;
  className?: string;
  /** 悬停「标注」入口（图片已加载时显示）；不传则完全保持原样 */
  onAnnotate?: () => void;
}): React.JSX.Element {
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
        'group relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-board bg-chip',
        className,
      )}
      aria-hidden={!onAnnotate}
    >
      {url ? (
        <>
          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
          {onAnnotate && (
            <button
              type="button"
              title="标注"
              aria-label="标注"
              className="absolute inset-0 hidden items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70 group-hover:flex"
              onClick={(e) => {
                e.stopPropagation();
                onAnnotate();
              }}
            >
              <PenLine size={11} />
            </button>
          )}
        </>
      ) : (
        <FileText size={12} className="text-muted" />
      )}
    </span>
  );
}
