/**
 * Cindy 同款目录选择：Folder chip + 最近目录 +「选择其他文件夹」。
 */
import { useState } from 'react';
import { ChevronDown, Folder, FolderPlus } from 'lucide-react';
import { cn } from '../lib/cn';
import { addRecentFolder, folderNameOf, getRecentFolders } from '../lib/recentFolders';
import { MorphPopover } from './ui/MorphPopover';

interface FolderPickerChipProps {
  cwd: string;
  onSelect: (path: string) => void;
  /** Cindy 新建页是 42px 大 chip；composer 工具行用 30px */
  size?: 'big' | 'compact';
}

export function FolderPickerChip({ cwd, onSelect, size = 'compact' }: FolderPickerChipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const recent = open ? getRecentFolders() : [];
  const label = cwd ? folderNameOf(cwd) : '选择文件夹';
  const big = size === 'big';

  const choose = async (path: string): Promise<void> => {
    addRecentFolder(path);
    onSelect(path);
    setOpen(false);
  };

  const browse = async (): Promise<void> => {
    const picked = await window.fundet.pickDirectory();
    if (picked) await choose(picked);
  };

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      title={cwd || '选择工作目录'}
      className={cn(
        'inline-flex max-w-full items-center gap-2.5 rounded-full border',
        'text-primary transition-colors select-none',
        big
          ? 'h-[42px] border-board bg-card px-[18px] text-14 font-medium hover:bg-hover'
          : // Cindy 会话态 composer 的路径按钮：带边框 pill（Folder 图标 + 目录名）
            'h-[30px] shrink-0 border-board bg-card px-3 text-13 hover:bg-hover',
      )}
    >
      <Folder size={big ? 15 : 15} className="shrink-0" />
      <span className="min-w-0 max-w-[200px] truncate">{label}</span>
      {big && <ChevronDown size={12} className="shrink-0 text-muted" />}
    </button>
  );

  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      panelWidth={320}
      panelClassName="p-2"
      panelAriaLabel="选择工作目录"
      wrapperClassName="min-w-0 shrink"
      trigger={trigger}
    >
      <div className="flex flex-col">
        {recent.length > 0 && (
          <>
            <div className="px-3 py-2 text-12 text-secondary">最近</div>
            <div className="max-h-[224px] overflow-y-auto">
              {recent.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => void choose(folder.path)}
                  className="flex w-full items-center gap-3 rounded-inner px-3 py-[10px] text-left hover:bg-menu-item-hover"
                >
                  <Folder size={20} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-14 font-medium text-primary">{folder.name}</span>
                    <span className="block truncate text-12 text-muted">{folder.path}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mx-2 my-1 h-px bg-board" />
          </>
        )}
        <button
          type="button"
          onClick={() => void browse()}
          className="flex w-full items-center gap-3 rounded-inner px-3 py-[10px] text-left hover:bg-menu-item-hover"
        >
          <FolderPlus size={20} className="shrink-0 text-muted" />
          <span className="text-14 font-medium text-primary">选择其他文件夹</span>
        </button>
      </div>
    </MorphPopover>
  );
}
