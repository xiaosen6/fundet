/**
 * ToolCallCard —— 工具调用卡片（复刻 Cindy components/chat/ToolCallCard.tsx 的解剖）。
 *
 * 折叠态：chevron + 扳手图标 + 一行等宽摘要（read(src/auth.ts) 式）。
 * 展开态：入参（edit 工具显示 old/new 简单行 diff；write 显示内容预览）+ 工具结果全文。
 * 卡片 = Card 底 + 1px Board + 12px 容器圆角，无阴影；展开/收起走 Collapse 动画。
 * tool_use / tool_result(_full) 由 store 按 toolUseId 配对好传入。
 */
import { useState } from 'react';
import { ChevronRight, LoaderCircle, Wrench } from 'lucide-react';
import { cn } from '../lib/cn';
import { isImagePath } from '../lib/artifacts';
import { extractEditPair, getToolSummary } from '../lib/toolText';
import { LocalImagePreview } from './LocalImagePreview';
import { Collapse } from './ui/Collapse';

interface ToolCallCardProps {
  toolName: string;
  input: Record<string, unknown>;
  resultText?: string;
  isError?: boolean;
  done: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
}

/** edit 入参的简单行 diff：old 行标 -、new 行标 +（GitHub diff 语义色，整行底色） */
function EditDiff({ oldText, newText }: { oldText: string; newText: string }): React.JSX.Element {
  return (
    <pre className="overflow-x-auto rounded-container border border-board bg-card p-3 text-13 leading-[1.5] select-text">
      {oldText.split('\n').map((line, i) => (
        <div key={`d${i}`} className="bg-diff-del-bg px-1 text-diff-del-fg">
          - {line}
        </div>
      ))}
      {newText.split('\n').map((line, i) => (
        <div key={`a${i}`} className="bg-diff-add-bg px-1 text-diff-add-fg">
          + {line}
        </div>
      ))}
    </pre>
  );
}

function CodeBlock({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-12 font-medium text-secondary">{label}</div>
      <pre className="max-h-[300px] overflow-auto rounded-container border border-board bg-card p-3 font-mono text-13 leading-[1.5] break-all whitespace-pre-wrap text-primary select-text">
        {text}
      </pre>
    </div>
  );
}

export function ToolCallCard({
  toolName,
  input,
  resultText,
  isError,
  done,
  workDir,
  onOpenFile,
}: ToolCallCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = getToolSummary(toolName, input);
  const name = toolName.toLowerCase();
  const editPair = name === 'edit' ? extractEditPair(input) : null;
  const writeContent =
    name === 'write' && typeof input.content === 'string' ? (input.content as string) : null;
  const filePath =
    typeof input.path === 'string'
      ? input.path
      : typeof input.file_path === 'string'
        ? (input.file_path as string)
        : null;
  const imagePath = filePath && isImagePath(filePath) ? filePath : null;

  return (
    <div className="max-w-full overflow-hidden rounded-container border border-board bg-card">
      {/* 标题行：始终可见 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-2 px-[14px] py-[10px]',
          'cursor-pointer text-left select-none',
          'transition-opacity hover:opacity-80',
        )}
      >
        <ChevronRight
          size={14}
          className={cn(
            'shrink-0 text-secondary',
            'transition-transform duration-[var(--motion-fast,150ms)]',
            expanded && 'rotate-90',
          )}
        />
        <Wrench size={14} className="shrink-0 text-secondary" />
        <span className="truncate font-mono text-13 leading-normal text-primary">{summary}</span>
        {!done && (
          <LoaderCircle size={13} className="ml-auto shrink-0 animate-fundet-spin text-muted" />
        )}
        {done && isError && <span className="ml-auto shrink-0 text-12 text-error">失败</span>}
      </button>

      {imagePath && workDir && (
        <div className="border-t border-board px-[14px] py-[10px]">
          <LocalImagePreview path={imagePath} workDir={workDir} onOpen={onOpenFile} />
        </div>
      )}

      <Collapse open={expanded}>
        <div className="border-t border-board px-[14px] py-[10px]">
          {filePath && onOpenFile && (
            <button
              type="button"
              className="mb-2 text-12 text-secondary hover:text-primary"
              onClick={() => onOpenFile(filePath)}
            >
              在 Canvas 打开
            </button>
          )}
          {editPair ? (
            <div className="mb-3 last:mb-0">
              <div className="mb-1 text-12 font-medium text-secondary">Diff</div>
              <EditDiff oldText={editPair.oldText} newText={editPair.newText} />
              {filePath && (
                <button
                  type="button"
                  className="mt-1 font-mono text-12 text-secondary hover:text-primary select-text"
                  onClick={() => onOpenFile?.(filePath)}
                >
                  {filePath}
                </button>
              )}
            </div>
          ) : writeContent !== null ? (
            <CodeBlock label={filePath ? `写入 ${filePath}` : '写入内容'} text={writeContent} />
          ) : (
            <CodeBlock label="Input" text={JSON.stringify(input, null, 2)} />
          )}
          {done && resultText !== undefined && resultText !== '' && (
            <CodeBlock label={isError ? 'Error' : 'Result'} text={resultText} />
          )}
        </div>
      </Collapse>
    </div>
  );
}
