/**
 * DocxPreview —— Word (.docx) 内嵌预览（mammoth 转 HTML）。
 * 能力边界：正文流语义（标题/段落/列表/表格/内联 base64 图片/超链接/粗斜体）；
 * 不保真页眉页脚、分页、脚注尾注、编号样式与原生版式。容器复用 .md 排版类
 * 与 Canvas markdown 预览观感一致；dangerouslySetInnerHTML 前过 sanitizeOfficeHtml。
 */
import { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import { bytesToArrayBuffer, sanitizeOfficeHtml } from '../lib/officePreview';
import { OfficePreviewError, OfficePreviewLoading, useOfficeFileBytes } from './officePreviewShared';

export function DocxPreview({ path, workDir }: { path: string; workDir: string }): React.JSX.Element {
  const file = useOfficeFileBytes(path, workDir);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError('');
    if (file.phase !== 'ready') return;
    const run = async (): Promise<void> => {
      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: bytesToArrayBuffer(file.bytes) });
        if (!cancelled) setHtml(sanitizeOfficeHtml(result.value));
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
  if (file.phase === 'loading') return <OfficePreviewLoading label="读取文档…" />;
  if (error) return <OfficePreviewError message={error} path={path} workDir={workDir} />;
  if (html === null) return <OfficePreviewLoading label="解析文档…" />;
  return (
    <div
      className="md office-docx min-h-0 flex-1 overflow-auto rounded-inner border border-board bg-card p-3 text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default DocxPreview;
