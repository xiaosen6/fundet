import { useEffect, useState } from 'react';
import { basename, isImagePath } from '../lib/artifacts';
import { cn } from '../lib/cn';
import { buildFilePreviewUrl } from '../../../shared/file-preview-url.ts';
import { showLightbox } from './ui/Lightbox';

export function looksLikeFilePath(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 512 || t.includes('\n') || /\s{2,}/.test(t)) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith('/') && t.includes('/')) return true;
  if (t.startsWith('./') || t.startsWith('.\\') || t.includes('/') || t.includes('\\')) {
    return isImagePath(t);
  }
  return isImagePath(t);
}

interface LocalImagePreviewProps {
  path: string;
  workDir: string;
  onOpen?: (path: string) => void;
  className?: string;
  alt?: string;
  maxHeight?: string;
}

export function LocalImagePreview({
  path,
  workDir,
  onOpen,
  className,
  alt,
  maxHeight = '360px',
}: LocalImagePreviewProps): React.JSX.Element {
  const protocolUrl = buildFilePreviewUrl(workDir, path);
  const [url, setUrl] = useState<string | null>(protocolUrl);
  const [error, setError] = useState('');
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    setError('');
    setUsedFallback(false);
    if (protocolUrl) {
      setUrl(protocolUrl);
      return;
    }
    setUrl(null);
    void window.fundet
      .readFileDataUrl(path, workDir)
      .then((next) => setUrl(next))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [protocolUrl, path, workDir]);

  const fallbackToDataUrl = (): void => {
    if (usedFallback) {
      setError('无法加载图片');
      return;
    }
    setUsedFallback(true);
    void window.fundet
      .readFileDataUrl(path, workDir)
      .then((next) => setUrl(next))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const open = (): void => {
    onOpen?.(path);
    if (url) showLightbox({ kind: 'image', src: url, alt: alt || basename(path) });
  };

  return (
    <span className={cn('my-2 block', className)}>
      <button
        type="button"
        onClick={open}
        title="点击查看大图"
        className="block max-w-full cursor-zoom-in rounded-inner border border-board bg-card p-1 text-left"
      >
        {url ? (
          <img
            src={url}
            alt={alt || basename(path)}
            className="max-w-full rounded-[6px] object-contain"
            style={{ maxHeight }}
            onError={fallbackToDataUrl}
          />
        ) : (
          <span className="block px-2 py-4 text-12 text-muted">
            {error || '加载图片…'}
            {/* 出界/读取失败时的逃生口：走系统默认程序打开（openPath 不受工作目录守卫限制） */}
            {error && /^([A-Za-z]:[\\/]|\/)/.test(path.trim()) && (
              <button
                type="button"
                className="ml-2 rounded-full border border-board px-2 py-0.5 text-11 text-secondary hover:text-primary"
                onClick={() => void window.fundet.openPath(path)}
              >
                用系统打开
              </button>
            )}
          </span>
        )}
      </button>
    </span>
  );
}
