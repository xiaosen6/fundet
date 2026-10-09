/**
 * AttachmentThumb —— 图片附件的 24×24 圆角缩略图（composer chip 与用户气泡共用）。
 *
 * 经 readFileDataUrl（deny-list 预览策略）读原图；非图片/读失败静默回落
 * FileText 图标，不阻断 chip 本身。大小上限由主进程 8MB 把关。
 * 传 onOpen 时缩略图可点击（打开 lightbox 预览/标注，Cindy 托盘缩略图同款
 * 入口形态——画笔在 lightbox 工具条里，不在缩略图上）；不传则完全保持原样。
 */
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../lib/cn';
import { fileKind } from '../../../shared/file-kind.ts';

export function AttachmentThumb({
  path,
  className,
  onOpen,
}: {
  path: string;
  className?: string;
  /** 点击缩略图打开 lightbox（仅 composer 未发送图片附件使用） */
  onOpen?: () => void;
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
  const content = url ? (
    <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <FileText size={12} className="text-muted" />
  );
  if (!onOpen) {
    return (
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-board bg-chip',
          className,
        )}
        aria-hidden
      >
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      title="查看图片"
      aria-label="查看图片"
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-board bg-chip',
        'cursor-pointer hover:border-[var(--input-focus-border)]',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {content}
    </button>
  );
}
