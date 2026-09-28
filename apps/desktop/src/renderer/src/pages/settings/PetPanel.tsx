/**
 * 桌宠面板：桌面助手显示开关（主进程持久化 pet.enabled，切换即时生效）。
 */
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

export function PetPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.fundet.petVisible().then(setEnabled).catch(() => setEnabled(false));
  }, []);

  const toggle = useCallback(async (): Promise<void> => {
    if (enabled === null || busy) return;
    setBusy(true);
    const next = !enabled;
    try {
      await window.fundet.petToggle(next);
      setEnabled(next);
    } catch {
      /* 失败保持原状态 */
    } finally {
      setBusy(false);
    }
  }, [enabled, busy]);

  return (
    <div className="flex flex-col gap-[14px]">
      <h2 className="text-16 leading-[1.2] font-medium text-primary">桌面助手</h2>
      <div className="rounded-xl border border-board bg-card-ivory p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-13 font-medium text-primary">显示桌面助手</p>
            <p className="mt-1 text-12 leading-relaxed text-secondary">
              在桌面显示 Fundet 桌宠：左键打开新对话、右键截图问答、拖动会跟着奔跑。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled === true}
            aria-label="显示桌面助手"
            disabled={enabled === null || busy}
            onClick={() => void toggle()}
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
      </div>
    </div>
  );
}
