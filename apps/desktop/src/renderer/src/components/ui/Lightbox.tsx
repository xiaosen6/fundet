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
 *
 * 标注模式（移植 Cindy ImageLightbox）：payload 带 annotationEdit 时（composer
 * 附件预览），底部工具条出现「标注」笔按钮；进入后鼠标当笔圈点（单工具：
 * 红笔迹 #FF3B30 + 白描边，线宽随图自适应），工具条切换为 Cindy 同款
 * [放弃][撤销] | [保存]。Esc = 放弃标注（再按才关）、Ctrl+Z 撤销上一笔、
 * 背景点击不关闭、双击缩放/平移让位给画笔。笔迹存归一化坐标，SVG 叠加层
 * 与烧录共用 lib/lightboxAnnotations.ts；保存 = 烧录成新 File 经 onSave
 * 交回调用方（删旧附件 chip + onAddFiles 替换语义）。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Check, Maximize2, Minus, Pen, Plus, Undo2, X } from 'lucide-react';
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
import {
  ANNOTATION_OUTLINE_COLOR,
  ANNOTATION_STROKE_COLOR,
  annotationStrokeWidth,
  normalizePoint,
  shouldAppendPoint,
  strokeToSvgPath,
  type AnnotationStroke,
} from '../../lib/lightboxAnnotations';
import { annotatedFileName, burnInAnnotations, dataUrlToSource } from '../../lib/annotationBurnIn';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Tooltip } from './Tooltip';
import { toast } from './toast';

/** 托盘附件的「标注编辑」出口：烧录产物交回调用方替换附件。 */
interface AnnotationEdit {
  onSave: (file: File) => void | Promise<void>;
}

type LightboxPayload =
  | { kind: 'image'; src: string; alt?: string; annotationEdit?: AnnotationEdit }
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

/**
 * 按 contain 语义把图片收进边界，且不放大超过自然尺寸（移植 Cindy
 * imageDisplaySize.containImageSize）。viewBox-only 的 SVG 叠加层在
 * shrink-to-fit 容器里会循环算尺寸塌成 0×0，必须给 img 显式宽高。
 */
function containImageSize(
  natural: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  if (
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    natural.width <= 0 ||
    natural.height <= 0 ||
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

export function LightboxHost(): React.JSX.Element | null {
  const [payload, setPayload] = useState<LightboxPayload | null>(null);
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>(RESET_VIEW);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    tx: number;
    ty: number;
    bounds: Bounds;
  } | null>(null);

  // ---- 标注模式状态（事件采集在此，几何/烧录纯函数在 lib/lightboxAnnotations） ----
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<AnnotationStroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  // 图片自然尺寸：SVG viewBox 与烧录 canvas 的坐标基准。onLoad 时设置。
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  // stage 内容盒尺寸（标注层显式宽高的 contain 边界）。
  const [stageBox, setStageBox] = useState<{ w: number; h: number } | null>(null);
  // 进行中笔迹的事实源：ref（事件 handler 同步读写），state 仅驱动 SVG 渲染。
  // 提交笔迹不能写在 setState updater 内部（StrictMode 双调会 push 两次）。
  const draftStrokeRef = useRef<AnnotationStroke | null>(null);
  // once-bound keydown handler 需要读到最新标注态。
  const isAnnotatingRef = useRef(false);
  const strokesRef = useRef<AnnotationStroke[]>([]);
  const savingRef = useRef(false);
  isAnnotatingRef.current = isAnnotating;
  strokesRef.current = strokes;

  const annotationEdit = payload?.kind === 'image' ? payload.annotationEdit : undefined;
  const canAnnotate = Boolean(annotationEdit) && naturalSize !== null;

  useEffect(() => {
    listeners.add(setPayload);
    return () => {
      listeners.delete(setPayload);
    };
  }, []);

  // ---- 标注模式手势 ----

  const undoLastStroke = useCallback((): void => {
    setStrokes((s) => s.slice(0, -1));
  }, []);

  /** 放弃标注：清笔迹退出标注模式（X 按钮与标注中的 Esc 都走这里）。 */
  const discardAnnotation = useCallback((): void => {
    setStrokes([]);
    setDraftStroke(null);
    setIsDrawing(false);
    draftStrokeRef.current = null;
    setIsAnnotating(false);
  }, []);

  /** 编辑模式出口：烧录当前所见成新 File 交回调用方替换附件。 */
  const handleAnnotationSave = useCallback(async (): Promise<void> => {
    if (!annotationEdit || !payload || payload.kind !== 'image' || savingRef.current) return;
    savingRef.current = true;
    try {
      const source = dataUrlToSource(payload.src);
      if (!source) throw new Error('unsupported image source');
      const { blob, mimeType } = await burnInAnnotations(source, strokesRef.current);
      const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
      const name = annotatedFileName(payload.alt ?? 'image', ext);
      await annotationEdit.onSave(new File([blob], name, { type: mimeType }));
      closeLightbox();
    } catch {
      toast.error('保存标注失败');
    } finally {
      savingRef.current = false;
    }
  }, [payload, annotationEdit]);

  // stage 尺寸随窗口/工具条布局变化 → 重算 contain 边界（ResizeObserver 拿内容盒）。
  useLayoutEffect(() => {
    if (!payload || payload.kind !== 'image') return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      setStageBox({ w: el.clientWidth - 48, h: el.clientHeight - 48 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [payload]);

  // 换图（含关闭再开）→ 复位视图与标注态
  useEffect(() => {
    setView(RESET_VIEW);
    setDragging(false);
    dragRef.current = null;
    setIsAnnotating(false);
    setStrokes([]);
    setDraftStroke(null);
    setIsDrawing(false);
    draftStrokeRef.current = null;
    setNaturalSize(null);
    setStageBox(null);
  }, [payload]);

  useEffect(() => {
    if (!payload) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // 标注模式中 Esc = 放弃标注（清笔迹退出），再按一次才关 lightbox。
        if (isAnnotatingRef.current) {
          discardAnnotation();
          return;
        }
        closeLightbox();
        return;
      }
      // 标注模式撤销上一笔。
      if (
        isAnnotatingRef.current &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        e.preventDefault();
        undoLastStroke();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payload, discardAnnotation, undoLastStroke]);

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

  // ---- 标注模式画笔事件 ----

  /** 标注模式画笔：mousedown 起笔（替代平移拖拽）。 */
  const onAnnotateMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = normalizePoint(e.clientX, e.clientY, rect);
    if (!point) return;
    draftStrokeRef.current = { points: [point] };
    setDraftStroke(draftStrokeRef.current);
    setIsDrawing(true);
  };

  // 画笔进行中：move/up 绑 window（移出图片仍能收尾），仅 isDrawing 时挂载。
  useEffect(() => {
    if (!isDrawing) return undefined;
    const onMove = (e: globalThis.MouseEvent): void => {
      const draft = draftStrokeRef.current;
      if (!draft) return;
      const rect = imgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = normalizePoint(e.clientX, e.clientY, rect);
      if (!point || !shouldAppendPoint(draft, point)) return;
      draftStrokeRef.current = { points: [...draft.points, point] };
      setDraftStroke(draftStrokeRef.current);
    };
    const onUp = (): void => {
      const draft = draftStrokeRef.current;
      draftStrokeRef.current = null;
      setIsDrawing(false);
      setDraftStroke(null);
      if (draft && draft.points.length > 0) {
        setStrokes((s) => [...s, draft]);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDrawing]);

  const zoomByCenter = (factor: number): void => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const origin: Translation = { tx: view.tx, ty: view.ty };
    setView(zoomAtPoint(view.scale, origin, { x: rect.width / 2, y: rect.height / 2 }, factor, rect));
  };

  const onImageDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
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

  // 平移只在 >1x 有意义（fit 以内图片没露边可拖）；标注模式下 mousedown 让位给画笔
  const onImagePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isAnnotating || e.button !== 0 || view.scale <= 1) return;
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

  const onImagePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setView((v) =>
      panView(v.scale, d.tx + (e.clientX - d.startX), d.ty + (e.clientY - d.startY), d.bounds),
    );
  };

  const endImageDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  if (!payload) return null;
  const isImage = payload.kind === 'image';
  const fitted = isImage && naturalSize && stageBox
    ? containImageSize(
        { width: naturalSize.w, height: naturalSize.h },
        stageBox.w,
        stageBox.h,
      )
    : null;
  return (
    <div
      className={cn(
        'fixed inset-0 z-[80] flex flex-col bg-black/80 backdrop-blur-[2px]',
        !reduced && 'animate-[tooltip-in_120ms_ease-out]',
      )}
      onMouseDown={(e) => {
        // 标注模式中背景点击不关闭，防误触丢笔迹；放弃走 X 按钮或 Esc。
        if (isAnnotating) return;
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
          // 标注中先放弃笔迹（与 Esc 首按同语义），再按才关。
          onClick={() => (isAnnotating ? discardAnnotation() : closeLightbox())}
        >
          <X size={16} />
        </button>
      </div>
      <div
        ref={stageRef}
        className={cn(
          'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6',
          !isAnnotating && 'cursor-zoom-out',
        )}
        onClick={() => {
          if (isAnnotating) return;
          closeLightbox();
        }}
      >
        {isImage ? (
          // 图片 + 标注层的公共 transform 容器：缩放/平移作用在容器上，SVG 笔迹
          // 天然跟随图片。容器 shrink-to-fit 贴合图片盒。
          <div
            className={cn(
              'relative rounded-container shadow-2xl select-none',
              isAnnotating
                ? 'cursor-crosshair'
                : view.scale > 1
                  ? dragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : 'cursor-zoom-in',
            )}
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: 'center center',
              transition: dragging || reduced ? 'none' : 'transform 120ms ease-out',
              touchAction: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={isAnnotating ? undefined : onImageDoubleClick}
            onMouseDown={isAnnotating ? onAnnotateMouseDown : undefined}
            onPointerDown={onImagePointerDown}
            onPointerMove={onImagePointerMove}
            onPointerUp={endImageDrag}
            onPointerCancel={endImageDrag}
          >
            <img
              ref={imgRef}
              src={payload.src}
              alt={payload.alt ?? ''}
              draggable={false}
              className="block max-h-full max-w-full rounded-container object-contain"
              style={{
                width: fitted?.width,
                height: fitted?.height,
                userSelect: 'none',
              }}
              onLoad={(e) =>
                setNaturalSize({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
            />
            {/* 标注层：viewBox = 图片自然尺寸，归一化笔迹 × 自然尺寸 = path
                坐标，与烧录一致（所见即所得）。pointerEvents 关闭，事件由容器接管。 */}
            {naturalSize && (strokes.length > 0 || draftStroke) ? (
              <svg
                viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden
              >
                {[...strokes, ...(draftStroke ? [draftStroke] : [])].map((stroke, i) => {
                  const d = strokeToSvgPath(stroke, naturalSize.w, naturalSize.h);
                  if (!d) return null;
                  const w = annotationStrokeWidth(naturalSize.w, naturalSize.h);
                  return (
                    // 笔迹列表只增/尾删，index 稳定。
                    <g key={i}>
                      <path
                        d={d}
                        fill="none"
                        stroke={ANNOTATION_OUTLINE_COLOR}
                        strokeWidth={Math.round(w * 1.8)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={ANNOTATION_STROKE_COLOR}
                        strokeWidth={w}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
              </svg>
            ) : null}
          </div>
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
          {isAnnotating ? (
            // 标注模式（Cindy 同款）：[放弃][撤销] | [保存]。
            <div
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 backdrop-blur',
                'border border-[var(--lightbox-toolbar-border)] bg-[var(--lightbox-toolbar-bg)]',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <ToolbarButton label="放弃标注" onClick={discardAnnotation}>
                <X className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton label="撤销上一笔" onClick={undoLastStroke}>
                <Undo2 className="h-4 w-4" />
              </ToolbarButton>
              <div className="mx-1 h-5 w-px bg-[var(--lightbox-toolbar-border)]" aria-hidden />
              <ToolbarButton label="保存标注" onClick={() => void handleAnnotationSave()}>
                <Check className="h-4 w-4" />
              </ToolbarButton>
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 text-13 backdrop-blur',
                'border border-[var(--lightbox-toolbar-border)] bg-[var(--lightbox-toolbar-bg)]',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <ToolbarButton label="缩小" onClick={() => zoomByCenter(1 / 1.25)}>
                <Minus className="h-4 w-4" />
              </ToolbarButton>
              <span className="w-11 text-center text-[var(--lightbox-toolbar-fg)] tabular-nums select-none">
                {Math.round(view.scale * 100)}%
              </span>
              <ToolbarButton label="放大" onClick={() => zoomByCenter(1.25)}>
                <Plus className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton label="复位 1:1" onClick={() => setView(RESET_VIEW)}>
                <Maximize2 className="h-4 w-4" />
              </ToolbarButton>
              {/* 标注入口（Cindy：工具条分隔线右侧成组的笔按钮） */}
              {canAnnotate ? (
                <>
                  <div className="mx-1 h-5 w-px bg-[var(--lightbox-toolbar-border)]" aria-hidden />
                  <ToolbarButton label="标注" onClick={() => setIsAnnotating(true)}>
                    <Pen className="h-4 w-4" />
                  </ToolbarButton>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 工具条圆形图标按钮（Cindy LightboxToolbarButton 同款）：h-7 w-7 圆钮，
 * hover 换 toolbar token 色；Tooltip 气泡抬到 lightbox(z-80) 之上。
 */
function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label} side="top" className="z-[90]">
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full',
          'text-[var(--lightbox-toolbar-fg)]',
          'hover:bg-[var(--lightbox-toolbar-hover-bg)] hover:text-[var(--lightbox-toolbar-fg-hover)]',
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
