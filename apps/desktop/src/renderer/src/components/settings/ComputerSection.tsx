/**
 * ComputerSection — 设置 → 通用「电脑操作」分区。
 * 开关默认关：开启后**新会话**注入 cua-driver 的 MCP 工具（截屏/鼠标/键盘，
 * 模型可操作整台桌面）。授权 = 这个开关本身，审批不再逐次弹窗（Cindy 同款
 * 取舍：一次操作上百步，逐次询问不可用）。
 */
import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { brand } from '../../../../shared/brand.ts';

export function ComputerSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [driverAvailable, setDriverAvailable] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.fundet
      .computerStatus()
      .then((s) => {
        setEnabled(s.enabled);
        setDriverAvailable(s.driverAvailable);
      })
      .catch(() => undefined);
  }, []);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    setError('');
    void window.fundet.setComputerEnabled(next).catch((err) => {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-secondary">电脑操作</p>
          <p className="mt-1 text-12 leading-[1.5] text-muted">
            开启后，新会话里助手可以查看屏幕并操作鼠标键盘（点击、输入、滚动），适合让
            助手代为操作本机软件。助手操作时屏幕会保持可见，请勿同时手动操作。建议在
            「自动」或「完全放行」权限的会话里使用。
          </p>
        </div>
        <Switch.Root
          checked={enabled}
          onCheckedChange={toggle}
          className="h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
        >
          <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
      </div>
      {!driverAvailable && (
        <p className="mt-2 border-t border-board pt-2 text-12 text-error">
          操作驱动（cua-driver）未就绪：请重新安装{brand.name}；开发环境运行
          node tools/cua-driver/update.mjs 下载。开启开关后新对话才会生效。
        </p>
      )}
      {error && <p className="mt-2 text-12 text-error">{error}</p>}
    </div>
  );
}
