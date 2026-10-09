/**
 * Lightbox — 全屏媒体查看（图片点开放大 / mermaid 图表放大，对齐 Cindy
 * ImageLightbox / MermaidLightbox 的合并轻量版）。
 *
 * 模块级 service：showLightbox({ src }) 或 showLightbox({ node })；宿主在
 * App 根挂一次。Esc / 点击遮罩 / 再次点击内容关闭；reduced-motion 无动画。
 *
 * 图片支持缩放平移（Cindy #5104 lightboxGestures 思路）：滚轮以光标为中心
 * 0.2x~8x 缩放、按住拖拽平移、双击在 1x↔2x 间切换、底部工具条 −/百分比/＋/复位。
 * 数学与 clamp 纯逻辑见 lib/lightboxGestures.ts；窗口 resize / 换图复位视图。
 */
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  RESET_VIEW,
  panView,
  wheelFactor,
  zoomAtPoint,
  type Bounds,
  type Point,
  type Translation,
  type View,
} from '../../lib/lightboxGestures';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type LightboxPayload =
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'node'; label?: string; node: ReactNode };

let listeners = new Set<(p: LightboxPayload | null) => void>();
let current: LightboxPayload | null = null;

export function showLightbox(payload: LightboxPayload): void {
  current = payload;
  for (const l of listeners) l(current);
}

export function closeLightbox(): void {
  current = null;
  for (const l of listeners) l(current);
}

export function LightboxHost(): React.JSX.Element | null {
  const [payload, setPayload] = useState<LightboxPayload | null>(null);
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>(RESET_VIEW);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    tx: number;
    ty: number;
    bounds: Bounds;
  } | null>(null);

  useEffect(() => {
    listeners.add(setPayload);
    return () => {
      listeners.delete(setPayload);
    };
  }, []);

  useEffect(() => {
    if (!payload) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeLightbox();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payload]);

  // 换图（含关闭再开）→ 复位视图
  useEffect(() => {
    setView(RESET_VIEW);
    setDragging(false);
    dragRef.current = null;
  }, [payload]);

  // 窗口 resize → clamp 依赖的视口尺寸变了，直接复位
  useEffect(() => {
    if (!payload) return undefined;
    const onResize = (): void => setView(RESET_VIEW);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [payload]);

  // 滚轮缩放：React 的 onWheel 挂在 root 上且 passive，preventDefault 无效，
  // 用原生非 passive 监听挡掉背后页面滚动；node 内容不劫持（卡片自己滚动）。
  useEffect(() => {
    if (!payload || payload.kind !== 'image') return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = wheelFactor(e.deltaY, e.deltaMode);
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setView((v) => zoomAtPoint(v.scale, { tx: v.tx, ty: v.ty }, point, factor, rect));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [payload]);

  const zoomByCenter = (factor: number): void => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const origin: Translation = { tx: view.tx, ty: view.ty };
    setView(zoomAtPoint(view.scale, origin, { x: rect.width / 2, y: rect.height / 2 }, factor, rect));
  };

  const onImageDoubleClick = (e: ReactMouseEvent<HTMLImageElement>): void => {
    e.stopPropagation();
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (view.scale > 1) {
      setView(RESET_VIEW);
      return;
    }
    const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setView(zoomAtPoint(view.scale, { tx: view.tx, ty: view.ty }, point, 2, rect));
  };

  // 平移只在 >1x 有意义（fit 以内图片没露边可拖）；1x 时按住不动即双击的起手
  const onImagePointerDown = (e: ReactPointerEvent<HTMLImageElement>): void => {
    if (e.button !== 0 || view.scale <= 1) return;
    const el = stageRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      tx: view.tx,
      ty: view.ty,
      bounds: { width: el.clientWidth, height: el.clientHeight },
    };
    setDragging(true);
  };

  const onImagePointerMove = (e: ReactPointerEvent<HTMLImageElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setView((v) =>
      panView(v.scale, d.tx + (e.clientX - d.startX), d.ty + (e.clientY - d.startY), d.bounds),
    );
  };

  const endImageDrag = (e: ReactPointerEvent<HTMLImageElement>): void => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  if (!payload) return null;
  const isImage = payload.kind === 'image';
  return (
    <div
      className={cn(
        'fixed inset-0 z-[80] flex flex-col bg-black/80 backdrop-blur-[2px]',
        !reduced && 'animate-[tooltip-in_120ms_ease-out]',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeLightbox();
      }}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="max-w-[60%] truncate text-13 text-white/70 select-none">
          {payload.kind === 'image' ? (payload.alt ?? '') : (payload.label ?? '')}
        </span>
        <button
          type="button"
          aria-label="关闭"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          onClick={closeLightbox}
        >
          <X size={16} />
        </button>
      </div>
      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-6"
        onClick={closeLightbox}
      >
        {isImage ? (
          <img
            src={payload.src}
            alt={payload.alt ?? ''}
            draggable={false}
            className={cn(
              'max-h-full max-w-full rounded-container object-contain shadow-2xl select-none',
              view.scale > 1 && !dragging && 'cursor-grab',
              dragging && 'cursor-grabbing',
              view.scale <= 1 && 'cursor-zoom-in',
            )}
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transition: dragging || reduced ? 'none' : 'transform 120ms ease-out',
              touchAction: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={onImageDoubleClick}
            onPointerDown={onImagePointerDown}
            onPointerMove={onImagePointerMove}
            onPointerUp={endImageDrag}
            onPointerCancel={endImageDrag}
          />
        ) : (
          <div
            className="max-h-full max-w-full overflow-auto rounded-container bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {payload.node}
          </div>
        )}
      </div>
      {isImage && (
        <div className="flex items-center justify-center pb-3">
          <div className="flex items-center gap-0.5 rounded-full bg-black/60 px-2 py-1 text-13 text-white/80 backdrop-blur-sm">
            <button
              type="button"
              aria-label="缩小"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 hover:text-white"
              onClick={() => zoomByCenter(1 / 1.25)}
            >
              <Minus size={14} />
            </button>
            <span className="w-11 text-center tabular-nums select-none">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              aria-label="放大"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 hover:text-white"
              onClick={() => zoomByCenter(1.25)}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              aria-label="复位 1:1"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 hover:text-white"
              onClick={() => setView(RESET_VIEW)}
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
