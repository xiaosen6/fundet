/**
 * LoginItemSection —— 设置 → 通用的「开机自启」卡（上游 #4533 对应项）。
 * IM 机器人要求应用常开才在线，登录项是天然配套。dev 态主进程拒绝开启，
 * 这里只读展示并说明。
 */
import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';

export function LoginItemSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void window.fundet
      .loginItemEnabled()
      .then(setEnabled)
      .catch(() => setUnavailable(true));
  }, []);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    window.fundet
      .setLoginItemEnabled(next)
      .catch((err: unknown) => {
        setEnabled(!next);
        setUnavailable(true);
        void err;
      });
  };

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-secondary">开机自启</p>
          <p className="mt-1 text-12 leading-[1.5] text-muted">
            {unavailable
              ? '当前环境不可用（开发模式不写入系统启动项）。'
              : '登录系统时自动启动本应用。挂着 IM 机器人的电脑建议开启，机器人需要应用在线。'}
          </p>
        </div>
        <Switch.Root
          checked={enabled}
          onCheckedChange={unavailable ? undefined : toggle}
          disabled={unavailable}
          className="h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
      </div>
    </div>
  );
}
