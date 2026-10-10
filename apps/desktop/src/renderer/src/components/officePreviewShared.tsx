/**
 * Office 预览共用件：readFileDataUrl → Uint8Array 读取 hook + 加载/错误卡。
 * 观感对齐 Canvas 现有分支（Loader2 spinner、错误文案 + 用系统打开逃生口）。
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { dataUrlToBytes } from '../lib/officePreview';

export type OfficeFileState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; bytes: Uint8Array };

/** 8MB 上限在主进程 readFileDataUrl（错误文案「图片超过 8MB」在此归一为通用口径）。 */
export function useOfficeFileBytes(path: string, workDir: string): OfficeFileState {
  const [state, setState] = useState<OfficeFileState>({ phase: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    const run = async (): Promise<void> => {
      try {
        const dataUrl = await window.fundet.readFileDataUrl(path, workDir);
        if (!cancelled) setState({ phase: 'ready', bytes: dataUrlToBytes(dataUrl) });
      } catch (err) {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : String(err);
        const message = /ENOENT/i.test(raw)
          ? '文件已不存在（可能已被助手清理）'
          : /超过\s*8\s*MB/.test(raw)
            ? '文件超过 8 MB，请用系统打开'
            : raw;
        setState({ phase: 'error', message });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [path, workDir]);
  return state;
}

export function OfficePreviewLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex min-h-[120px] flex-1 items-center justify-center gap-2 text-12 text-muted">
      <Loader2 size={14} className="animate-spin" /> {label}
    </div>
  );
}

export function OfficePreviewError({
  message,
  path,
  workDir,
}: {
  message: string;
  path: string;
  workDir: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-3 rounded-inner border border-board bg-card px-6 py-8 text-center">
      <p className="text-13 text-primary">预览失败：{message}</p>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-board px-3 py-1 text-12 text-secondary hover:text-primary"
        onClick={() => void window.fundet.openPath(path, workDir || undefined)}
      >
        <ExternalLink size={12} /> 用系统打开
      </button>
    </div>
  );
}
