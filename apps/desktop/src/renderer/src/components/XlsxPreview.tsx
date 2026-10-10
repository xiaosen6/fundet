/**
 * XlsxPreview —— Excel (.xlsx/.xlsm) 表格预览（SheetJS 社区版）。
 * 能力边界：值网格预览（多 sheet chip 切换；首行表头加粗；等宽数字），
 * 只渲染前 50 行 × 前 12 列（尺寸从 !ref 解析，不整表展开），不带原生
 * 单元格样式/公式结果缓存以外的计算（公式显示其缓存值）。
 */
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/cn';
import { OfficePreviewError, OfficePreviewLoading, useOfficeFileBytes } from './officePreviewShared';

const MAX_ROWS = 50;
const MAX_COLS = 12;

export function XlsxPreview({ path, workDir }: { path: string; workDir: string }): React.JSX.Element {
  const file = useOfficeFileBytes(path, workDir);
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [error, setError] = useState('');
  const [sheetIdx, setSheetIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError('');
    setSheetIdx(0);
    if (file.phase !== 'ready') return;
    try {
      const wb = XLSX.read(file.bytes, { type: 'array' });
      if (!cancelled) setBook(wb);
    } catch (err) {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      cancelled = true;
    };
  }, [file]);

  const sheet = useMemo(() => {
    if (!book || book.SheetNames.length === 0) return null;
    const idx = Math.min(sheetIdx, book.SheetNames.length - 1);
    const name = book.SheetNames[idx];
    const ws = book.Sheets[name];
    if (!ws) return null;
    const dim = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    // 截断窗口直读（A1 语义），大表不整表展开成行数组
    const range = dim
      ? XLSX.utils.encode_range({
          s: dim.s,
          e: {
            r: Math.min(dim.s.r + MAX_ROWS - 1, dim.e.r),
            c: Math.min(dim.s.c + MAX_COLS - 1, dim.e.c),
          },
        })
      : undefined;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: true, range });
    return {
      name,
      aoa,
      totalRows: dim ? dim.e.r - dim.s.r + 1 : aoa.length,
      totalCols: dim ? dim.e.c - dim.s.c + 1 : Math.max(0, ...aoa.map((r) => r.length)),
    };
  }, [book, sheetIdx]);

  if (file.phase === 'error') return <OfficePreviewError message={file.message} path={path} workDir={workDir} />;
  if (file.phase === 'loading') return <OfficePreviewLoading label="读取表格…" />;
  if (error) return <OfficePreviewError message={error} path={path} workDir={workDir} />;
  if (!sheet) return <OfficePreviewError message="表内没有工作表" path={path} workDir={workDir} />;

  const colWidth = Math.max(...sheet.aoa.map((r) => r.length), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {book && book.SheetNames.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {book.SheetNames.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setSheetIdx(i)}
              className={cn(
                'h-6 max-w-[160px] truncate rounded-full border px-2.5 text-11 transition-colors',
                i === sheetIdx
                  ? 'border-accent bg-accent text-card'
                  : 'border-transparent text-secondary hover:border-board hover:text-primary',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-inner border border-board bg-card">
        <table className="w-full border-collapse text-13">
          <thead>
            <tr className="bg-chip">
              {Array.from({ length: colWidth }, (_, c) => (
                <th
                  key={c}
                  className="max-w-[240px] truncate border border-board px-2 py-1 text-left align-top font-medium whitespace-nowrap text-primary"
                >
                  {cellText(sheet.aoa[0]?.[c])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {sheet.aoa.slice(1, MAX_ROWS).map((row, r) => (
              <tr key={r}>
                {Array.from({ length: colWidth }, (_, c) => (
                  <td
                    key={c}
                    className="max-w-[240px] truncate border border-board px-2 py-1 align-top whitespace-nowrap text-secondary"
                  >
                    {cellText(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(sheet.totalRows > MAX_ROWS || sheet.totalCols > MAX_COLS) && (
        <p className="shrink-0 text-11 text-muted">
          仅预览前 {Math.min(MAX_ROWS, sheet.totalRows)} 行
          {sheet.totalCols > MAX_COLS ? ` × 前 ${MAX_COLS} 列` : ''}，完整内容请用系统打开。
        </p>
      )}
    </div>
  );
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export default XlsxPreview;
