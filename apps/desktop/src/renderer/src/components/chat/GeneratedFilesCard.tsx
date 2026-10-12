/**
 * GeneratedFilesCard — 每个 user turn 末尾的「本条消息生成的文件」pill 行。
 * 数据由 lib/generatedFiles 从持久化条目派生（write/edit 目标 + 轮末扫描的
 * turnArtifacts；脚本/源码类扩展已滤掉，只留交付物），历史轮同样渲染；
 * 无产物不占版面（返回 null）。UI 为一行小 pill（用户拍板：不要大文档卡，
 * 和之前一样）——文档类/图片给格式图标区分。
 *
 * 点击：Canvas 可预览的（PDF 原生 iframe、文本/图片/网页/音视频）走
 * onOpenFile 开 Canvas 侧栏；docx/pptx/xlsx 及其余用系统默认应用打开
 * （FS_OPEN_PATH，路由判定与 generatedFileOpenAction 同口径）。
 */
import { memo, useState } from 'react';
import { ChevronDown, ChevronUp, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  MAX_VISIBLE_GENERATED_FILES,
  foldGeneratedFiles,
  generatedFileOpenAction,
  type GeneratedFileRef,
} from '../../lib/generatedFiles';
import { toast } from '../ui/toast';

function PillIcon({ file, size = 14 }: { file: GeneratedFileRef; size?: number }) {
  const cls = 'shrink-0 opacity-70';
  if (file.doc === 'pptx') return <Presentation size={size} className={cls} aria-hidden="true" />;
  if (file.doc === 'xlsx') return <FileSpreadsheet size={size} className={cls} aria-hidden="true" />;
  return <FileText size={size} className={cls} aria-hidden="true" />;
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
      <PillIcon file={file} />
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

  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      <span className="text-12 font-medium text-secondary">本条消息生成的文件</span>
      {visible.map((f) => (
        <GeneratedFileChip key={f.path} file={f} onOpen={open} />
      ))}
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
  );
});
