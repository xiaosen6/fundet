import { Minus, Square, X } from 'lucide-react';
import { cn } from '../lib/cn';

export function hasFramelessControls(): boolean {
  return window.fundet.platform === 'win32';
}

export function WindowControls(): React.JSX.Element | null {
  if (!hasFramelessControls()) return null;
  const btn =
    // no-drag 要落在按钮本体上：压在 drag-region 上时，容器级 no-drag 在 Windows
    // 的 app-region 命中测试里不一定生效，症状就是 hover/点击全无反应。
    'no-drag flex h-[46px] w-[46px] items-center justify-center text-muted transition-colors hover:bg-hover hover:text-primary';
  return (
    <div className="no-drag flex">
      <button type="button" className={btn} title="最小化" onClick={() => window.fundet.windowMinimize()}>
        <Minus size={16} />
      </button>
      <button type="button" className={btn} title="最大化" onClick={() => window.fundet.windowMaximize()}>
        <Square size={13} />
      </button>
      <button
        type="button"
        className={cn(btn, 'hover:bg-[#E81123] hover:text-white')}
        title="关闭"
        onClick={() => window.fundet.windowClose()}
      >
        <X size={16} />
      </button>
    </div>
  );
}
