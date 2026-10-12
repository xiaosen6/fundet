/**
 * AgentActionRow —— 工作流块展开体内的单行工具调用（Cindy
 * AgentActionRow v2/v10 同款形态；Fundet 差异：文件点击走 Fundet 的
 * onOpenFile 路由（Canvas/系统打开）而非 Lightbox 家族，无 ghost/媒体链路，
 * isError 行状态槽换红色 XCircle——失败不能被画成完成）。
 *
 * 视觉契约（Cindy .pen 参考帧 1Tnsk）：
 *   - 行：rounded-8 px-2 py-[3px]，hover 提升 bg（group）
 *   - 状态槽固定 16px：running=Loader2 旋转 / done=Check / error=XCircle 红
 *   - 动词 label 14px 灰；write/edit/read 渲染文件 chip（点击预览）；
     命令类渲染命令文本（truncate + title 完整命令）
 *   - write/edit 尾部 +N/-N 行数统计（等宽字体，加绿减红）
 *   - 命令类点击行 = 就地展开 input+result 卡片（v10，不再开全屏弹窗）
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, File as FileIcon, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ROW_VERB_TEXT, shortToolName, verbForTool } from '../../lib/agent-actions/verbAggregator';
import type { DisplayItem } from '../../stores/sessionStore';

type ToolItem = Extract<DisplayItem, { kind: 'tool' }>;

/** 点击走「文件类」交互（chip 预览）的工具；其余命令类就地展开 */
const FILE_PATH_TOOLS = new Set(['edit', 'write', 'read']);

function basenameOf(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

function inputString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** write/edit 的 ±N 行数统计（Cindy diffStats 同语义的简版） */
function statsForToolCall(item: ToolItem): { add: number; del: number } | null {
  const name = shortToolName(item.toolName).toLowerCase();
  const inp = item.input ?? {};
  if (name === 'write') {
    const content = inputString(inp, ['content']);
    if (content === null) return null;
    return { add: content.split('\n').length, del: 0 };
  }
  if (name === 'edit') {
    // edits[] schema 与 legacy 顶层 {oldText,newText} 两种形态
    const edits = Array.isArray(inp.edits) ? (inp.edits as Array<Record<string, unknown>>) : null;
    if (edits) {
      let add = 0;
      let del = 0;
      for (const e of edits) {
        add += String(e.newText ?? e.new_text ?? '').split('\n').length;
        del += String(e.oldText ?? e.old_text ?? '').split('\n').length;
      }
      return { add, del };
    }
    const n = inputString(inp, ['newText', 'new_string']) ?? '';
    const o = inputString(inp, ['oldText', 'old_string']) ?? '';
    if (!n && !o) return null;
    return { add: n.split('\n').length, del: o.split('\n').length };
  }
  return null;
}

/** 行 display 参数：文件类给 basename+全路径；命令类给命令首行截断 */
function displayParamOf(item: ToolItem): { text: string; full?: string } | null {
  const name = shortToolName(item.toolName).toLowerCase();
  const inp = item.input ?? {};
  const file = inputString(inp, ['path', 'file_path', 'filePath', 'target']);
  if (FILE_PATH_TOOLS.has(name)) {
    if (!file) return null;
    return { text: basenameOf(file), full: file };
  }
  if (name === 'bash' || name === 'exec') {
    const cmd = inputString(inp, ['command', 'cmd']);
    if (!cmd) return null;
    const first = cmd.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
    const s = first.trim().replace(/\s+/g, ' ');
    return { text: s.length > 80 ? `${s.slice(0, 80)}…` : s, full: cmd };
  }
  const query = inputString(inp, ['query', 'pattern', 'url']);
  if (query) return { text: query.slice(0, 80), full: query };
  return null;
}

/** 就地展开时展示的 input 文本（命令类：多参数键值拼行） */
function formatInlineInput(item: ToolItem): string {
  const inp = item.input ?? {};
  const name = shortToolName(item.toolName).toLowerCase();
  const cmd = inputString(inp, ['command', 'cmd']);
  if (cmd && (name === 'bash' || name === 'exec')) return cmd;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(inp)) {
    if (typeof v === 'string') lines.push(`${k}: ${v}`);
    else if (v !== null && v !== undefined) lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  return lines.join('\n');
}

export function AgentActionRow({
  item,
  running,
  workDir,
  onOpenFile,
}: {
  item: ToolItem;
  /** 会话运行中且该调用结果未到 */
  running: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const name = shortToolName(item.toolName).toLowerCase();
  const isFileTool = FILE_PATH_TOOLS.has(name);
  const verb = ROW_VERB_TEXT[verbForTool(item.toolName)];
  const display = useMemo(() => displayParamOf(item), [item]);
  const stats = useMemo(() => statsForToolCall(item), [item]);
  const filePath = isFileTool ? inputString(item.input ?? {}, ['path', 'file_path', 'filePath', 'target']) : null;
  const isError = item.isError === true && item.done;
  const status = isError ? 'error' : running ? 'running' : 'done';

  const onActivate = (): void => {
    if (isFileTool && filePath && onOpenFile) {
      onOpenFile(filePath);
      return;
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={!isFileTool ? expanded : undefined}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-[6px] rounded-[8px]',
          'px-2 py-[3px] text-left outline-none select-none',
          'transition-colors duration-[var(--motion-fast,150ms)] hover:bg-hover',
        )}
      >
        {/* 状态槽固定 16px：同槽换图标零位移 */}
        <span
          role="img"
          aria-label={status === 'running' ? '进行中' : status === 'error' ? '失败' : '完成'}
          className="inline-flex h-[18px] w-4 shrink-0 items-center justify-center text-muted"
        >
          {status === 'running' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : status === 'error' ? (
            <XCircle size={13} className="text-error" />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="shrink-0 text-14 text-secondary">{verb}</span>
        {display &&
          (filePath ? (
            // 文件 chip（点击走预览路由）
            <span
              className={cn(
                'inline-flex min-w-0 max-w-full cursor-pointer items-center gap-[3px] whitespace-nowrap rounded-[4px]',
                'border border-board bg-chip px-[5px] py-[0.5px] font-mono text-13 leading-[1.385]',
                'transition-colors group-hover:bg-hover',
              )}
            >
              <FileIcon size={12} className="shrink-0 text-muted" />
              <span className="truncate">{display.text}</span>
            </span>
          ) : (
            <span className="min-w-0 cursor-pointer truncate text-14 font-medium text-secondary" title={display.full ?? display.text}>
              {display.text}
            </span>
          ))}
        <span className="flex-1" />
        {stats && (
          <span className="flex shrink-0 gap-1 font-mono text-13 font-medium">
            <span className="text-success">+{stats.add}</span>
            <span className="text-error">-{stats.del}</span>
          </span>
        )}
        <span aria-hidden="true" className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted">
          {!isFileTool && expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {/* v10 就地展开：命令类 input + result（可选中复制） */}
      {!isFileTool && expanded && (
        <div
          className={cn(
            'mx-2 mb-1 mt-1 cursor-text rounded-[6px] border border-board bg-chip px-[10px] py-2 select-text',
            'font-mono text-12 leading-[1.6] text-primary',
          )}
        >
          {(() => {
            const inputText = formatInlineInput(item);
            const result = item.resultText ?? '';
            return (
              <>
                {inputText && <pre className="m-0 break-words whitespace-pre-wrap">{inputText}</pre>}
                {result && (
                  <>
                    {inputText && <div className="my-2 h-px bg-board" />}
                    <pre className={cn('m-0 break-words whitespace-pre-wrap', isError ? 'text-error' : 'text-secondary')}>
                      {result}
                    </pre>
                  </>
                )}
                {!inputText && !result && <span className="text-secondary">无可展示内容</span>}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
