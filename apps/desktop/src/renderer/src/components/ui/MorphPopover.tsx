/**
 * MorphPopover —— 「chip 脱身上浮长成弹层」的容器形变原语（移植自 Cindy，
 * DESIGN.md §14.4 容器形变类目，签名交互）。
 *
 * 与 Radix Popover 的区别：弹层不是在目标位置凭空浮现，而是以 trigger chip 的
 * 精确几何（位置/尺寸/胶囊圆角/pill 底色）为形变起点，一边生长一边整体位移，
 * 最终停靠在 chip 的 side 侧、留 GAP 间隙；关闭时反向缩回 chip。
 * trigger chip 全程可见、可交互 —— 面板打开后再点 chip 即关闭。
 *
 * 实现要点（每条都对应 Cindy 踩过的坑）：
 * - portal + position:fixed 锚定视口坐标，豁免 composer 工具条 overflow 裁剪。
 * - side='top' 底边锚定、生长时底边从 chip 底边上浮到 chip 顶边上方 GAP 处。
 * - 测量目标几何时必须临时禁用 transition（否则 offsetHeight 量出假高度）。
 * - 形变起点圆角 = chip 高度一半，禁止 9999px（9999→12 插值中途帧会变形）。
 * - prefers-reduced-motion 降级为直切；焦点/Esc/outside-click 语义与 §14.2 相同。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

const MORPH_MS = 220;
const MORPH_EASE = 'cubic-bezier(0.3, 0.9, 0.25, 1)';
/** 面板停靠位与 chip 之间的间隙（对齐 Radix sideOffset 习惯） */
const SIDE_GAP = 6;
/** 面板与视口边缘的最小留白（对齐 Radix collisionPadding 习惯） */
const VIEWPORT_PADDING = 8;

/** 形变属性集（§14.4）；opacity 仅收合相位使用（与位移耦合整体淡出） */
const MORPH_TRANSITION = [
  `width ${MORPH_MS}ms ${MORPH_EASE}`,
  `height ${MORPH_MS}ms ${MORPH_EASE}`,
  `top ${MORPH_MS}ms ${MORPH_EASE}`,
  `bottom ${MORPH_MS}ms ${MORPH_EASE}`,
  `border-radius ${MORPH_MS}ms ${MORPH_EASE}`,
  `background-color ${MORPH_MS}ms ease`,
  `border-color ${MORPH_MS}ms ease`,
  `box-shadow ${MORPH_MS}ms ease`,
  `opacity ${MORPH_MS}ms ease`,
].join(', ');

interface MorphPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** trigger chip（调用方渲染完整按钮，含 aria-expanded/haspopup 与点击开关）。 */
  trigger: ReactNode;
  /** 面板内容（role/选项行由调用方定义）。 */
  children: ReactNode;
  /** 停靠方向：top = 浮到 chip 上方（composer 默认）；bottom = 沉到下方。 */
  side?: 'top' | 'bottom';
  /** 水平对齐：start = 左缘对齐 chip；end = 右缘对齐（工具条右端控件用）。 */
  align?: 'start' | 'end';
  /** 固定面板宽度(px)。内容含换行文本时必须提供；否则按 max-content 自适应。 */
  panelWidth?: number;
  /** 面板形变起点底色/边色（= chip 的），默认 composer pill 规格。 */
  startBg?: string;
  startBorderColor?: string;
  /** 面板终态底色/边色，默认 dropdown 规格（Card + Board）。 */
  endBg?: string;
  endBorderColor?: string;
  /** 形变起点圆角(px)，默认取 chip 高度一半。 */
  startRadius?: number;
  /** 面板内容容器 className（padding 等由调用方给）。 */
  panelClassName?: string;
  /** trigger 外层 wrapper className（布局用）。 */
  wrapperClassName?: string;
  /** 面板 aria-label。 */
  panelAriaLabel?: string;
  /** 打开完成后的外部焦点目标；未提供时按面板内默认规则聚焦。 */
  autoFocusTarget?: () => HTMLElement | null;
}

/** 是否处于 reduced-motion */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function MorphPopover({
  open,
  onOpenChange,
  trigger,
  children,
  side = 'top',
  align = 'start',
  panelWidth,
  startBg = 'var(--composer-pill-bg)',
  startBorderColor = 'var(--board)',
  endBg = 'var(--card)',
  endBorderColor = 'var(--board)',
  startRadius,
  panelClassName,
  wrapperClassName,
  panelAriaLabel,
  autoFocusTarget,
}: MorphPopoverProps): React.JSX.Element {
  // mounted 独立于 open：关闭时先播收合动画，动画完再卸载 portal
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 收合焦点快照的 setTimeout(0) id（快照必须晚于浏览器默认聚焦）
  const focusSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 开场双 rAF 的 id：关闭打断时必须取消，否则已排队的回调会在 open 翻 false 后
  // 仍套用「打开几何 + opacity 1」，菜单闪回
  const openRaf1Ref = useRef<number | null>(null);
  const openRaf2Ref = useRef<number | null>(null);
  // 收合的回归几何 = 打开瞬间的 chip rect
  const chipRectRef = useRef<DOMRect | null>(null);
  // 初始形变是否已完成（ResizeObserver 只在其后接管）
  const settledRef = useRef(false);
  // 指针驱动的关闭不把焦点归还 trigger；键盘关闭按 §14.2 回焦
  const pointerInteractionRef = useRef(false);

  const requestClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  if (open && !mounted) setMounted(true);

  /** 定宽量高。调用前必须已把 panel.style.transition 置为 'none'。 */
  const measure = useCallback(
    (panel: HTMLDivElement, chipRect: DOMRect) => {
      const prevW = panel.style.width;
      const prevH = panel.style.height;
      panel.style.height = 'auto';
      let desiredW: number;
      if (panelWidth) {
        desiredW = Math.max(panelWidth, chipRect.width);
      } else {
        panel.style.width = 'max-content';
        desiredW = Math.max(panel.offsetWidth, chipRect.width);
      }
      // 视口宽度钳制 + 锚定侧可用宽度钳制，floor 到 chip 宽保证脱身起点连贯
      const viewportMaxW = Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2);
      const sideAvailW =
        align === 'end'
          ? chipRect.right - VIEWPORT_PADDING
          : window.innerWidth - chipRect.left - VIEWPORT_PADDING;
      const targetW = Math.min(desiredW, viewportMaxW, Math.max(chipRect.width, sideAvailW));
      panel.style.width = `${targetW}px`;
      // 可视高度钳制：停靠位到视口边缘的可用空间（内容区自滚）
      const avail =
        side === 'top'
          ? chipRect.top - SIDE_GAP - VIEWPORT_PADDING
          : window.innerHeight - chipRect.bottom - SIDE_GAP - VIEWPORT_PADDING;
      const targetH = Math.min(panel.offsetHeight, Math.max(0, avail));
      panel.style.width = prevW;
      panel.style.height = prevH;
      return { w: targetW, h: targetH };
    },
    [align, panelWidth, side],
  );

  /** 把已展开面板无条件补量到内容最新尺寸（settle 时调用一次） */
  const syncPanelToContent = useCallback(() => {
    const panel = panelRef.current;
    const rect = chipRectRef.current;
    if (!panel || !rect) return;
    const prevT = panel.style.transition;
    panel.style.transition = 'none';
    const m = measure(panel, rect);
    const curW = panel.offsetWidth;
    const curH = panel.offsetHeight;
    panel.style.width = `${curW}px`;
    panel.style.height = `${curH}px`;
    void panel.offsetHeight;
    panel.style.transition = prevT;
    // 差 1px 内不动，防 ResizeObserver 观察回环
    if (Math.abs(m.w - curW) <= 1 && Math.abs(m.h - curH) <= 1) return;
    panel.style.width = `${m.w}px`;
    panel.style.height = `${m.h}px`;
  }, [measure]);

  /** 面板锚到 chip 的形变起点几何（closed 视觉态：与 chip 重合的胶囊） */
  const applyChipGeometry = useCallback(
    (panel: HTMLDivElement, rect: DOMRect) => {
      panel.style.left = align === 'start' ? `${rect.left}px` : 'auto';
      panel.style.right = align === 'end' ? `${window.innerWidth - rect.right}px` : 'auto';
      panel.style.top = side === 'bottom' ? `${rect.top}px` : 'auto';
      panel.style.bottom = side === 'top' ? `${window.innerHeight - rect.bottom}px` : 'auto';
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;
      panel.style.borderRadius = `${startRadius ?? rect.height / 2}px`;
      panel.style.backgroundColor = startBg;
      panel.style.borderColor = startBorderColor;
      panel.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
    },
    [align, side, startBg, startBorderColor, startRadius],
  );

  /** 停靠位的锚边值（脱身后面板贴靠的 top/bottom） */
  const dockedAnchor = useCallback(
    (rect: DOMRect) =>
      side === 'top'
        ? { prop: 'bottom' as const, value: window.innerHeight - rect.top + SIDE_GAP }
        : { prop: 'top' as const, value: rect.bottom + SIDE_GAP },
    [side],
  );

  /** 开合主流程：全部几何走 DOM 直写（避免 state 往返打断同帧测量） */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wrap = wrapRef.current;
    if (!mounted || !panel || !wrap) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);

    const reduced = prefersReducedMotion();

    if (open) {
      settledRef.current = false;
      pointerInteractionRef.current = false;
      const rect = wrap.getBoundingClientRect();
      chipRectRef.current = rect;
      // 1) 面板落到 chip 精确几何（起点透明：与位移耦合淡入，防盖住 chip 内容闪一下）
      panel.style.transition = 'none';
      applyChipGeometry(panel, rect);
      panel.style.opacity = '0';
      // 形变期间内容区禁滚（滚动条闪现会挤压行宽抖动），settle 后再开自滚
      if (contentRef.current) contentRef.current.style.overflowY = 'hidden';
      panel.dataset.state = 'closed';
      panel.inert = false;
      // 2) 定宽量高（transition 已关，量到的是真实终态排版）
      const m = measure(panel, rect);
      // 3) 回初始几何并强制 reflow，再恢复 transition
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;
      void panel.offsetHeight;
      panel.style.transition = reduced ? 'none' : MORPH_TRANSITION;
      // 4) 双 rAF 过渡：生长 + 脱身位移到停靠位
      openRaf1Ref.current = requestAnimationFrame(() => {
        openRaf2Ref.current = requestAnimationFrame(() => {
          openRaf1Ref.current = null;
          openRaf2Ref.current = null;
          if (!panelRef.current) return;
          const dock = dockedAnchor(rect);
          panel.dataset.state = 'open';
          panel.style.width = `${m.w}px`;
          panel.style.height = `${m.h}px`;
          panel.style[dock.prop] = `${dock.value}px`;
          panel.style.borderRadius = '12px';
          panel.style.backgroundColor = endBg;
          panel.style.borderColor = endBorderColor;
          panel.style.boxShadow = 'var(--shadow-menu)';
          panel.style.opacity = '1';
        });
      });
      // 5) 焦点：autofocus 标记 → 首个 input → 首个可交互项 → 面板容器
      const focusDelay = reduced ? 0 : MORPH_MS;
      closeTimerRef.current = setTimeout(() => {
        settledRef.current = true;
        syncPanelToContent();
        if (contentRef.current) {
          // Windows 经典滚动条：取整误差的 1px 假溢出也会挂出一条常驻滚动条，
          // 只在内容真溢出时才开滚。
          const c = contentRef.current;
          c.style.overflowY = c.scrollHeight > c.clientHeight + 1 ? 'auto' : 'hidden';
        }
        const target =
          autoFocusTarget?.() ??
          panel.querySelector<HTMLElement>('[data-morph-autofocus]:not([disabled])') ??
          panel.querySelector<HTMLElement>('input, textarea') ??
          panel.querySelector<HTMLElement>(
            'button:not([disabled]), [role="option"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
          ) ??
          panel;
        target.focus({ preventScroll: true });
      }, focusDelay);
    } else {
      // 收合：缩回 chip 几何并整体淡出，动画完卸载并归还焦点
      if (openRaf1Ref.current !== null) cancelAnimationFrame(openRaf1Ref.current);
      if (openRaf2Ref.current !== null) cancelAnimationFrame(openRaf2Ref.current);
      openRaf1Ref.current = null;
      openRaf2Ref.current = null;
      settledRef.current = false;
      // 收合目标 = trigger chip 的**当前**位置/尺寸（开着期间 trigger 可能变）
      const liveRect = wrap.getBoundingClientRect();
      const rect = liveRect.width > 0 ? liveRect : chipRectRef.current;
      if (rect) chipRectRef.current = rect;
      const reducedClose = reduced || !rect;
      panel.dataset.state = 'closed';
      if (contentRef.current) contentRef.current.style.overflowY = 'hidden';
      if (rect) applyChipGeometry(panel, rect);
      panel.style.opacity = '0';
      // 焦点归还判定延迟一拍快照（outside pointerdown 的默认聚焦发生在事件派发之后）
      let ownedFocusAtClose = false;
      focusSnapTimerRef.current = setTimeout(() => {
        focusSnapTimerRef.current = null;
        const active = document.activeElement;
        ownedFocusAtClose =
          !pointerInteractionRef.current &&
          active instanceof Node &&
          (panel.contains(active) || wrap.contains(active));
        // inert 把收合余辉整体移出 tab order 与辅助树
        panel.inert = true;
      }, 0);
      closeTimerRef.current = setTimeout(
        () => {
          setMounted(false);
          if (ownedFocusAtClose) {
            const active = document.activeElement;
            const focusClaimedElsewhere =
              active instanceof Node &&
              active !== document.body &&
              !panel.contains(active) &&
              !wrap.contains(active);
            if (!focusClaimedElsewhere) {
              wrap.querySelector<HTMLElement>('button, [tabindex]')?.focus({
                preventScroll: true,
              });
            }
          }
        },
        reducedClose ? 0 : MORPH_MS + 20,
      );
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (focusSnapTimerRef.current) clearTimeout(focusSnapTimerRef.current);
      if (openRaf1Ref.current !== null) cancelAnimationFrame(openRaf1Ref.current);
      if (openRaf2Ref.current !== null) cancelAnimationFrame(openRaf2Ref.current);
    };
  }, [
    mounted,
    open,
    measure,
    applyChipGeometry,
    dockedAnchor,
    endBg,
    endBorderColor,
    syncPanelToContent,
    autoFocusTarget,
  ]);

  /** 打开稳定后跟随内容尺寸变化，同曲线平滑过渡 */
  useEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!mounted || !open || !panel || !content || typeof ResizeObserver === 'undefined') return;
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      // RO 回调内直接写布局会触发告警 —— 推迟到下一帧，合并同帧通知
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        if (!settledRef.current) return;
        syncPanelToContent();
      });
    });
    ro.observe(content);
    return () => {
      if (roRaf) cancelAnimationFrame(roRaf);
      ro.disconnect();
    };
  }, [mounted, open, syncPanelToContent]);

  /** 打开期间的全局关闭手势：outside pointerdown / Esc / 焦点离开 / 窗口 resize */
  useEffect(() => {
    if (!mounted || !open) return;
    const isWithinExternalFocusTarget = (target: Node): boolean => {
      const externalFocusTarget = autoFocusTarget?.();
      return Boolean(
        externalFocusTarget &&
          (externalFocusTarget === target || externalFocusTarget.contains(target)),
      );
    };
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || wrapRef.current?.contains(t)) return;
      if ((t as Element).closest?.('[data-radix-popper-content-wrapper]')) return;
      if (isWithinExternalFocusTarget(t)) return;
      pointerInteractionRef.current = true;
      requestClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        pointerInteractionRef.current = false;
      }
      if (e.key !== 'Escape') return;
      pointerInteractionRef.current = false;
      if (document.querySelector('[data-radix-popper-content-wrapper] [role="dialog"]')) return;
      requestClose();
    };
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (!(target instanceof Node) || target === document.body) return;
      if (panelRef.current?.contains(target) || wrapRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper]')) return;
      if (isWithinExternalFocusTarget(target)) return;
      requestClose();
    };
    const onResize = (): void => requestClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('resize', onResize);
    };
  }, [autoFocusTarget, mounted, open, requestClose]);

  return (
    <>
      <span
        ref={wrapRef}
        className={cn('relative inline-flex', wrapperClassName)}
        onPointerDownCapture={() => {
          pointerInteractionRef.current = true;
        }}
      >
        {trigger}
      </span>
      {mounted &&
        createPortal(
          <div
            ref={panelRef}
            data-state="closed"
            role="group"
            aria-label={panelAriaLabel}
            tabIndex={-1}
            onPointerDownCapture={() => {
              pointerInteractionRef.current = true;
            }}
            // data-[state=closed]:pointer-events-none —— 收合动画期间面板已透明但仍
            // 以 fixed 覆盖视口，不加会拦住底下点击
            className="group fixed z-50 overflow-hidden border outline-none data-[state=closed]:pointer-events-none"
            // 初始几何由 useLayoutEffect 直写；这里只兜首帧不可见位置
            style={{ left: -9999, bottom: -9999 }}
          >
            {/* 面板内容：随生长淡入（50ms 延迟 + 5px 浮入）；形变期禁滚 */}
            <div
              ref={contentRef}
              className={cn(
                'max-h-full overflow-y-hidden',
                side === 'top' ? 'translate-y-[5px]' : 'translate-y-[-5px]',
                'opacity-0 transition-[opacity,transform] delay-[50ms] duration-[140ms] ease-out',
                'group-data-[state=open]:translate-y-0 group-data-[state=open]:opacity-100',
                'motion-reduce:transition-none',
                panelClassName,
              )}
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
