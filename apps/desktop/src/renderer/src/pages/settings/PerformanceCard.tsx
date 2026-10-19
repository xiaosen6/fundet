/**
 * 性能卡（通用设置页）：闲置会话自动回收开关（内存批 P0-A）。
 * 每个聊过的会话常驻一只 Agent 运行时进程（实测 ~160MB）；闲置 30 分钟自动
 * 回收，下次发消息自动恢复上下文（首次约 6 秒启动）。低内存机器建议开启。
 */
import { useEffect, useState } from 'react';
import { MemoryStick } from 'lucide-react';
import { cn } from '../../lib/cn';

export function PerformanceCard(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void window.fundet.idleRecycleGet().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(true));
  }, []);

  const toggle = (): void => {
    if (enabled === null) return;
    setEnabled(!enabled);
    void window.fundet.idleRecycleSet(!enabled).catch(() => undefined);
  };

  return (
    <section className="fundet-surface rounded-container border border-board p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MemoryStick size={14} className="shrink-0 text-secondary" />
            <p className="text-13 font-medium text-primary">闲置会话自动回收</p>
          </div>
          <p className="mt-1 text-12 leading-relaxed text-secondary">
            每个聊过的会话常驻一个 Agent 运行时进程（约 160 MB 内存）；闲置超过 30
            分钟自动回收，再次发消息时自动恢复上下文（首次约需 6 秒）。内存小的电脑建议开启。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label="闲置会话自动回收"
          disabled={enabled === null}
          onClick={toggle}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
            enabled ? 'bg-accent' : 'bg-[var(--input-focus-border)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              enabled ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>
    </section>
  );
}
