import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { basename, isImagePath } from '../lib/artifacts';
import { cn } from '../lib/cn';
import { buildFilePreviewUrl } from '../../../shared/file-preview-url.ts';

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
  const [zoom, setZoom] = useState(false);
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
    if (url) setZoom(true);
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
          <span className="block px-2 py-6 text-12 text-muted">{error || '加载图片…'}</span>
        )}
      </button>
      {zoom && url
        ? createPortal(
            <button
              type="button"
              className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/70 p-6"
              onClick={() => setZoom(false)}
              title="点击关闭"
            >
              <img
                src={url}
                alt={alt || basename(path)}
                className="max-h-[92vh] max-w-[92vw] object-contain"
              />
            </button>,
            document.body,
          )
        : null}
    </span>
  );
}
