/**
 * Splash —— 启动首屏遮罩（renderer 内实现，无需 Electron 侧改动）。
 *
 * 遮住 React 挂载抖动 + 字体加载 + 首次会话列表拉取；品牌球光泽扫动
 * （loading 语义）。最短亮 500ms 防「闪一下就没了」，就绪后 200ms 淡出卸载。
 * prefers-reduced-motion 由 CSS 白名单接管（光泽静止）。
 */
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { BrandMark } from './BrandMark';

const MIN_SHOWN_MS = 500;
const FADE_MS = 200;

export function Splash(): React.JSX.Element | null {
  const [phase, setPhase] = useState<'on' | 'fade' | 'gone'>('on');

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const minShown = new Promise<void>((resolve) => setTimeout(resolve, MIN_SHOWN_MS));
    const ready = window.fundet.listSessions().catch(() => undefined);
    void Promise.all([minShown, ready]).then(() => {
      if (!alive) return;
      setPhase('fade');
      timers.push(setTimeout(() => alive && setPhase('gone'), FADE_MS));
    });
    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      aria-hidden
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-surface select-none',
        phase === 'fade' && 'pointer-events-none opacity-0 transition-opacity duration-[var(--motion-base)]',
      )}
    >
      <div className="brand-sheen">
        <BrandMark size={64} />
      </div>
      <div className="text-20 font-medium tracking-tight text-secondary">{brand.name}</div>
    </div>
  );
}
