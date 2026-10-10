/**
 * TurnChangesBar —— 轮末改动文件条（对齐 Cindy TurnChangesCard v1）。
 * 最新一轮任务完成后出现在 composer 上方：FileDiff 图标 + 「N 个文件改动」
 * + +/- 总数；默认收起为一行，点开列文件（图标+文件名+单文件 +/-），点文件
 * 打开 Canvas 预览。数据来自 checkpoint 快照 numstat（仅最新一轮，不持久化）。
 */
import { useEffect, useState } from 'react';
import { FileDiff, FileSpreadsheet, FileText, Film, Globe, Image as ImageIcon, Music, Presentation } from 'lucide-react';
import { basename } from '../lib/artifacts';
import type { FileKind } from '../../../shared/file-kind.ts';
import { fileKind } from '../../../shared/file-kind.ts';

export interface TurnChangeEntry {
  path: string;
  additions: number;
  deletions: number;
}

function KindIcon({ kind }: { kind: FileKind }): React.JSX.Element {
  const props = { size: 12 as const };
  if (kind === 'image') return <ImageIcon {...props} />;
  if (kind === 'video') return <Film {...props} />;
  if (kind === 'audio') return <Music {...props} />;
  if (kind === 'html') return <Globe {...props} />;
  if (kind === 'xlsx') return <FileSpreadsheet {...props} />;
  if (kind === 'pptx') return <Presentation {...props} />;
  return <FileText {...props} />;
}

export function TurnChangesBar({
  files,
  onOpenFile,
}: {
  files: TurnChangeEntry[];
  onOpenFile: (path: string) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  // 新一轮改动到来时自动收起
  useEffect(() => {
    setExpanded(false);
  }, [files]);

  if (files.length === 0) return null;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const shown = expanded ? files : files.slice(0, 3);

  return (
    <div className="fundet-surface mx-auto w-full max-w-[820px] rounded-container border border-board bg-card px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <FileDiff size={14} className="shrink-0 text-secondary" />
        <span className="text-12 font-medium text-primary">本轮 {files.length} 个文件改动</span>
        <span className="flex items-baseline gap-1.5 font-mono text-11 tabular-nums">
          <span className="text-diff-add-fg">+{additions}</span>
          <span className="text-diff-del-fg">−{deletions}</span>
        </span>
        <span className="ml-auto text-11 text-muted">{expanded ? '收起' : files.length > 3 ? `展开 ${files.length - 3} 个` : '展开'}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col border-t border-board pt-1.5">
          {shown.map((f) => (
            <button
              key={f.path}
              type="button"
              title={f.path}
              onClick={() => onOpenFile(f.path)}
              className="flex items-center gap-2 rounded-inner px-1.5 py-1 text-left hover:bg-hover"
            >
              <KindIcon kind={fileKind(f.path)} />
              <span className="min-w-0 flex-1 truncate text-12 text-primary">{basename(f.path)}</span>
              <span className="shrink-0 font-mono text-11 tabular-nums">
                <span className="text-diff-add-fg">+{f.additions}</span>{' '}
                <span className="text-diff-del-fg">−{f.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
