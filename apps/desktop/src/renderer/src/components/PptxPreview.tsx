/**
 * PptxPreview —— PPT (.pptx) 逐页文本卡片预览。
 * 能力边界：文本版大纲——jszip 解压后只解析 ppt/slides/slideN.xml 的 <a:t>
 * 文本（纯函数 extractPptxSlideTexts，可测），不渲染图形/图片/SmartArt/备注页；
 * 图形里的文字若不在 slide XML 文本节点里则不显示。每页一张卡纵向滚动。
 */
import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { extractPptxSlideTexts, isPptxSlidePath, type PptxSlideText } from '../lib/officePreview';
import { OfficePreviewError, OfficePreviewLoading, useOfficeFileBytes } from './officePreviewShared';

export function PptxPreview({ path, workDir }: { path: string; workDir: string }): React.JSX.Element {
  const file = useOfficeFileBytes(path, workDir);
  const [slides, setSlides] = useState<PptxSlideText[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSlides(null);
    setError('');
    if (file.phase !== 'ready') return;
    const run = async (): Promise<void> => {
      try {
        const zip = await JSZip.loadAsync(file.bytes);
        const map: Record<string, string> = {};
        for (const [name, entry] of Object.entries(zip.files)) {
          if (entry.dir || !isPptxSlidePath(name)) continue;
          map[name] = await entry.async('string');
        }
        const out = extractPptxSlideTexts(map);
        if (out.length === 0) throw new Error('包内没有可读取的幻灯片文本');
        if (!cancelled) setSlides(out);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (file.phase === 'error') return <OfficePreviewError message={file.message} path={path} workDir={workDir} />;
  if (file.phase === 'loading') return <OfficePreviewLoading label="读取演示文稿…" />;
  if (error) return <OfficePreviewError message={error} path={path} workDir={workDir} />;
  if (slides === null) return <OfficePreviewLoading label="解析幻灯片…" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      {slides.map((slide) => (
        <section key={slide.number} className="shrink-0 rounded-inner border border-board bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full border border-board bg-chip px-2 py-0.5 text-11 font-medium text-secondary">
              第 {slide.number} 页
            </span>
            <span className="text-11 text-muted">{slide.lines.length > 0 ? `${slide.lines.length} 段文本` : ''}</span>
          </div>
          {slide.lines.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {slide.lines.map((line, i) => (
                <li key={i} className="text-13 leading-relaxed text-primary">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-12 text-muted">（本页无文本，可能只有图形或图片）</p>
          )}
        </section>
      ))}
    </div>
  );
}

export default PptxPreview;
