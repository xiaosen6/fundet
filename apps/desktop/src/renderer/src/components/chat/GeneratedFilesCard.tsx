/**
 * GeneratedFilesCard — 每个 user turn 末尾的「本轮产出文件」卡（Cindy
 * GeneratedFilesCard 移植，用户拍板对齐 Cindy）。数据由 lib/generatedFiles
 * 从持久化 tool 条目派生（write/edit 目标路径），历史轮同样渲染；无产物
 * 不占版面（返回 null）。
 *
 * 条目两形态：①普通 pill；②pdf/docx/pptx/xlsx 文档卡——v1 顶部为简单的
 * 格式图标 + 文件名 + 格式标签（Cindy 的 xlsx 表格 / pptx 幻灯片预览是
 * 重量级组件，未搬）。超过 6 个折叠「显示另外 N 个」/「收起」。
 *
 * 点击：Canvas 可预览的（文本/代码/图片/网页/音视频）走 onOpenFile 开
 * Canvas 侧栏；pdf/docx/pptx/xlsx 及其余用系统默认应用打开（FS_OPEN_PATH）。
 */
import { memo, useState } from 'react';
import { ChevronDown, ChevronUp, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  FORMAT_LABELS,
  MAX_VISIBLE_GENERATED_FILES,
  foldGeneratedFiles,
  generatedFileOpenAction,
  type GeneratedDocFormat,
  type GeneratedFileRef,
} from '../../lib/generatedFiles';
import { toast } from '../ui/toast';

function DocFormatIcon({ format, size = 24 }: { format: GeneratedDocFormat; size?: number }) {
  if (format === 'xlsx') return <FileSpreadsheet size={size} aria-hidden="true" />;
  if (format === 'pptx') return <Presentation size={size} aria-hidden="true" />;
  return <FileText size={size} aria-hidden="true" />;
}

function DocFileCard({
  file,
  onOpen,
}: {
  file: GeneratedFileRef;
  onOpen: (file: GeneratedFileRef) => void;
}): React.JSX.Element {
  const format = file.doc as GeneratedDocFormat;
  const formatLabel = FORMAT_LABELS[format];
  return (
    <button
      type="button"
      title={file.path}
      onClick={() => onOpen(file)}
      className="group block w-full max-w-[420px] cursor-pointer overflow-hidden rounded-container border border-board bg-card text-left transition-colors hover:border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      {/* 顶部格式预览（v1 简化：格式图标 + 文件名 + 格式标签） */}
      <span className="flex h-[142px] flex-col items-center justify-center gap-2 border-b border-board bg-chip px-4 py-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-board bg-card text-secondary">
          <DocFormatIcon format={format} />
        </span>
        <span className="line-clamp-2 max-w-full text-15 font-semibold leading-5 text-primary">{file.name}</span>
        <span className="text-11 font-medium uppercase tracking-[0.1em] text-muted">{formatLabel}</span>
      </span>
      {/* 底部标题 + 元信息行（Cindy 同构：格式标签 · 文件名） */}
      <span className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13 font-medium leading-5 text-primary">{file.name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-11 text-muted">
            <span className="shrink-0">{formatLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{file.name}</span>
          </span>
        </span>
        <span className="shrink-0 text-muted transition-colors group-hover:text-secondary">
          <FileText size={15} aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

function GeneratedFileChip({
  file,
  onOpen,
}: {
  file: GeneratedFileRef;
  onOpen: (file: GeneratedFileRef) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={file.path}
      onClick={() => onOpen(file)}
      className="inline-flex h-7 max-w-[280px] cursor-pointer items-center gap-1.5 rounded-full bg-chip px-2.5 py-1.5 text-13 font-medium text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <FileText size={14} className="shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate">{file.name}</span>
    </button>
  );
}

export const GeneratedFilesCard = memo(function GeneratedFilesCard({
  files,
  workDir,
  onOpenFile,
}: {
  files: readonly GeneratedFileRef[];
  workDir?: string;
  onOpenFile?: (path: string) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;

  const open = (file: GeneratedFileRef): void => {
    if (generatedFileOpenAction(file.path) === 'canvas' && onOpenFile) {
      onOpenFile(file.path);
      return;
    }
    window.fundet.openPath(file.path, workDir || undefined).catch((err: unknown) => {
      toast.error(`打开文件失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const { visible, hiddenCount } = foldGeneratedFiles(files, expanded);
  const hasDocs = files.some((f) => f.doc);
  const onlyDocs = files.every((f) => f.doc);

  return (
    <div className="my-1 flex flex-col gap-2">
      {!onlyDocs && <span className="text-12 font-medium text-secondary">本条消息生成的文件</span>}
      <div className={cn('flex flex-wrap gap-2', hasDocs && 'flex-col')}>
        {visible.map((f) =>
          f.doc ? <DocFileCard key={f.path} file={f} onOpen={open} /> : <GeneratedFileChip key={f.path} file={f} onOpen={open} />,
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 py-1.5 text-13 text-secondary transition-colors hover:bg-hover"
          >
            显示另外 {hiddenCount} 个
            <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
          </button>
        )}
        {expanded && files.length > MAX_VISIBLE_GENERATED_FILES && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 py-1.5 text-13 text-secondary transition-colors hover:bg-hover"
          >
            收起
            <ChevronUp size={14} className="shrink-0" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});
