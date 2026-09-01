/**
 * SendButton —— 发送/中断一体按钮（复刻 Cindy new-chat/SendButton.tsx）。
 *
 * Send（idle）：28×28 圆形（pill），反相 CTA 底（--accent，Light 黑 / Dark 白），
 * ArrowUp 图标（--accent-fg）。Stop（流式）：同壳，内容换成 10×10 圆角 1.5 的
 * 停止方块。两态图标叠放同格交叉淡切（150ms opacity+scale，compositor-only），
 * 替代条件渲染的硬换。按压 active:scale-[0.98]（§14.4 按压原型）。
 */
import { ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn';

interface SendButtonProps {
  disabled: boolean;
  onClick: () => void;
  /** true 时渲染流式 Stop 变体 */
  isStreaming?: boolean;
}

export function SendButton({ disabled, onClick, isStreaming = false }: SendButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled && !isStreaming}
      onClick={onClick}
      title={isStreaming ? '中断当前回合' : '发送'}
      aria-label={isStreaming ? '中断当前回合' : '发送'}
      className={cn(
        // transform 进过渡集：承载 active 按压缩放
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[color,background-color,transform]',
        // 可用：反相 CTA 底（--accent，hover 深/浅一档）；禁用：专用灰底灰字（R4 档）
        !disabled || isStreaming
          ? 'bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.98]'
          : 'cursor-not-allowed bg-send-disabled-bg text-send-disabled-icon',
      )}
    >
      {/* send / stop 两态图标叠放同格交叉淡切 */}
      <span className="relative grid h-3.5 w-3.5 place-items-center" aria-hidden>
        <span
          className={cn(
            'col-start-1 row-start-1 flex items-center justify-center',
            'transition-[opacity,transform] duration-[var(--motion-fast,150ms)] ease-[var(--motion-ease-out)]',
            isStreaming ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
          )}
        >
          <ArrowUp size={14} strokeWidth={2.2} />
        </span>
        <span
          className={cn(
            'col-start-1 row-start-1 block h-[10px] w-[10px] rounded-[1.5px] bg-accent-fg',
            'transition-[opacity,transform] duration-[var(--motion-fast,150ms)] ease-[var(--motion-ease-out)]',
            isStreaming ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
          )}
        />
      </span>
    </button>
  );
}
