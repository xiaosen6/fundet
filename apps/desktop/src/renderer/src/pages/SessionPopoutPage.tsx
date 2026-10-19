/**
 * SessionPopoutPage —— 会话只读弹窗（CDS 批四）。
 *
 * 关键形态：**静态全量转录**（非虚拟化）——原生 findInPage 只搜已挂载 DOM，
 * 复用主聊天 TanStack 虚拟化会让屏外历史搜不到；这里所有文本行都在 DOM 里，
 * Ctrl+F 可达全部历史。数据复用 ensureHistory + useSessionSlice（实时事件
 * 同样广播到本窗口，流式也跟着走）。刻意无任何变更入口（无 composer/编辑/
 * 删除/分叉/分享/回滚）。
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ensureHistory, useSessionList, useSessionSlice } from '../stores/sessionStore';
import { AssistantMessage } from '../components/AssistantMessage';
import { FindBar } from '../components/FindBar';
import { WindowControls } from '../components/WindowControls';
import type { DisplayItem } from '../stores/sessionStore';

export function SessionPopoutPage(): React.JSX.Element {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const slice = useSessionSlice(sessionId);
  const sessions = useSessionList();
  const [findOpen, setFindOpen] = useState(false);
  const meta = sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (sessionId) void ensureHistory(sessionId);
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-surface text-primary">
      {/* 头部：46px 拖拽条对齐主窗（Frameless 控件区让位） */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-board px-3 pr-[150px]">
        <button
          type="button"
          title="返回主窗口"
          className="p-1 text-secondary hover:text-primary"
          onClick={() => window.close()}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="min-w-0 flex-1 truncate text-13 font-medium text-primary" title={meta?.title}>
          {meta?.title || '会话'} · <span className="text-muted">只读</span>
        </span>
        <WindowControls />
      </div>
      <FindBar open={findOpen} onClose={() => setFindOpen(false)} />
      {/* 静态全量转录：普通文档流（无虚拟化）——findInPage 全文可达 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[820px] px-4 py-4">
          {slice.items.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-13 text-muted">
              <Loader2 size={14} className="animate-spin" />
              加载会话记录…
            </div>
          )}
          {slice.items.map((item) => (
            <PopoutRow key={item.id} item={item} />
          ))}
          {slice.streamingText && <AssistantMessage text={slice.streamingText} />}
        </div>
      </div>
    </div>
  );
}

/** 只读行渲染：文本类全量进 DOM（搜索面），工具/思考给摘要行。 */
function PopoutRow({ item }: { item: DisplayItem }): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return (
        <div className="my-3 ml-auto max-w-[85%] rounded-container bg-chip px-3.5 py-2.5 text-14 whitespace-pre-wrap">
          {item.text}
          {item.attachments && item.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-11 text-muted">
              {item.attachments.map((a) => (
                <span key={a.path} className="rounded-full border border-board px-1.5 py-0.5">
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case 'assistant':
      return (
        <div className="my-3">
          <AssistantMessage text={item.text} />
        </div>
      );
    case 'thinking':
      return item.text ? (
        <p className="my-1.5 border-l-2 border-board py-1 pl-3 text-13 italic whitespace-pre-wrap text-muted">
          {item.text}
        </p>
      ) : null;
    case 'tool': {
      const input = item.input as Record<string, unknown>;
      const summary =
        typeof input['path'] === 'string' ? String(input['path']) : item.done ? '（已完成）' : '（执行中）';
      return (
        <p className="my-1 pl-3 font-mono text-11 text-muted">
          {item.toolName} {summary}
        </p>
      );
    }
    case 'notice':
    case 'error':
      return (
        <p className={`my-2 text-12 ${item.kind === 'error' ? 'text-error' : 'text-muted'}`}>
          {item.kind === 'error' ? (item as { message?: string }).message : (item as { text?: string }).text}
        </p>
      );
    default:
      // done / task / turnArtifacts：无正文，搜索面不受益
      return null;
  }
}
