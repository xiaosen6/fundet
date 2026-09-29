/**
 * 桌宠面板：桌宠显示开关（主进程持久化 pet.enabled，切换即时生效）+
 * 完成提醒开关（声音 + 系统通知；持久化 pet.notify，默认开）。
 */
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

function SwitchRow({
  title,
  description,
  checked,
  busy,
  onToggle,
  ariaLabel,
}: {
  title: string;
  description: string;
  checked: boolean | null;
  busy: boolean;
  onToggle: () => void;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-13 font-medium text-primary">{title}</p>
        <p className="mt-1 text-12 leading-relaxed text-secondary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked === true}
        aria-label={ariaLabel}
        disabled={checked === null || busy}
        onClick={onToggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
          checked ? 'bg-accent' : 'bg-[var(--input-focus-border)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function PetPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.fundet.petVisible().then(setEnabled).catch(() => setEnabled(false));
    void window.fundet.notifyEnabledGet().then((r) => setNotify(r.enabled)).catch(() => setNotify(true));
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

  const toggleNotify = useCallback(async (): Promise<void> => {
    if (notify === null || busy) return;
    setBusy(true);
    const next = !notify;
    try {
      await window.fundet.notifyEnabledSet(next);
      setNotify(next);
    } catch {
      /* 失败保持原状态 */
    } finally {
      setBusy(false);
    }
  }, [notify, busy]);

  return (
    <div className="flex flex-col gap-[14px]">
      <h2 className="text-16 leading-[1.2] font-medium text-primary">桌宠</h2>
      <div className="flex flex-col gap-5 rounded-xl border border-board bg-card-ivory p-5">
        <SwitchRow
          title="显示桌宠"
          description="在桌面显示 Fundet 桌宠：左键打开新对话，右键截图问答。"
          checked={enabled}
          busy={busy}
          onToggle={() => void toggle()}
          ariaLabel="显示桌宠"
        />
        <SwitchRow
          title="完成提醒"
          description="任务结束时用提示音和系统通知提醒（仅当窗口不在前台时；点击通知跳到对应会话）。"
          checked={notify}
          busy={busy}
          onToggle={() => void toggleNotify()}
          ariaLabel="完成提醒"
        />
      </div>
    </div>
  );
}
