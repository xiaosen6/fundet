/**
 * AnnotationEditor —— 发送前的图片标注编辑器（全屏遮罩，观感对齐 Lightbox）。
 *
 * 原图经 readFileDataUrl 读为 dataURL；在缩放视图上绘制（pointer 事件），
 * 操作以归一化坐标入撤销栈；「保存并替换」= 离屏 canvas 按自然分辨率画原图
 * 再重放操作 → toBlob('image/png') → 新 File（原名-标注.png）经 onSave 交上层
 * 走现有附件 stage 管线替换原附件。逻辑层在 lib/annotation.ts（node --test 覆盖）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Loader2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { toast } from './ui/toast';
import {
  ANNOTATION_COLORS,
  ANNOTATION_WIDTHS,
  annotatedFileName,
  clampPoint,
  clearAnnotations,
  emptyAnnotationHistory,
  pushAnnotationOp,
  redoAnnotationOp,
  replayAnnotationOps,
  textFontPx,
  undoAnnotationOp,
  type AnnotationHistoryState,
  type AnnotationOp,
  type AnnotationTool,
} from '../lib/annotation';

interface AnnotationEditorProps {
  /** 附件本地路径（readFileDataUrl 读原图） */
  path: string;
  /** 原文件名（生成「原名-标注.png」） */
  name: string;
  onCancel: () => void;
  /** 烧录完成的 PNG File，交上层替换原附件 */
  onSave: (file: File) => void;
}

interface TextInputState {
  /** 归一化锚点（提交入栈用） */
  nx: number;
  ny: number;
  /** 显示坐标（相对画布，绝对定位行内输入用） */
  dx: number;
  dy: number;
  /** 显示字号（换算归一化 size 用） */
  fontPx: number;
  value: string;
}

const TOOL_ITEMS: { tool: AnnotationTool; label: string; Icon: typeof Square }[] = [
  { tool: 'rect', label: '矩形', Icon: Square },
  { tool: 'arrow', label: '箭头', Icon: ArrowUpRight },
  { tool: 'pen', label: '画笔', Icon: Pencil },
  { tool: 'text', label: '文字', Icon: Type },
];

export function AnnotationEditor({ path, name, onCancel, onSave }: AnnotationEditorProps): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotationTool>('rect');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS.red);
  const [width, setWidth] = useState<number>(ANNOTATION_WIDTHS[0]);
  const [history, setHistory] = useState<AnnotationHistoryState>(emptyAnnotationHistory);
  const [draft, setDraft] = useState<AnnotationOp | null>(null);
  const [textInput, setTextInput] = useState<TextInputState | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Esc 分层：文字输入开着时先让输入框自己处理 */
  const textInputOpenRef = useRef(false);

  useEffect(() => {
    let alive = true;
    window.fundet
      .readFileDataUrl(path, '')
      .then((u) => {
        if (alive) setSrc(u);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = (): void => setImage(img);
    img.onerror = (): void => setError('图片解码失败');
    img.src = src;
  }, [src]);

  // 全量重绘：原图 + 已提交操作 + 进行中的草稿
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    replayAnnotationOps(ctx, draft ? [...history.ops, draft] : history.ops, canvas.width, canvas.height);
  }, [image, history.ops, draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !textInputOpenRef.current) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const normalizedPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return clampPoint({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  const commitTextInput = useCallback((): void => {
    const t = textInput;
    textInputOpenRef.current = false;
    setTextInput(null);
    if (!t || t.value.trim().length === 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const maxDim = Math.max(rect?.width ?? 1, 1);
    setHistory((h) =>
      pushAnnotationOp(h, {
        type: 'text',
        color,
        x: t.nx,
        y: t.ny,
        size: t.fontPx / maxDim,
        text: t.value,
      }),
    );
  }, [textInput, color]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!image || textInput || e.button !== 0) return;
    const p = normalizedPointer(e);
    if (tool === 'text') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const fontPx = textFontPx(Math.max(rect.width, rect.height));
      setTextInput({ nx: p.x, ny: p.y, dx: p.x * rect.width, dy: p.y * rect.height, fontPx, value: '' });
      textInputOpenRef.current = true;
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') setDraft({ type: 'pen', color, width, points: [p] });
    else setDraft({ type: tool, color, width, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!draft) return;
    const p = normalizedPointer(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.type === 'pen') {
        const last = d.points[d.points.length - 1]!;
        if (Math.abs(p.x - last.x) < 0.0015 && Math.abs(p.y - last.y) < 0.0015) return d;
        return { ...d, points: [...d.points, p] };
      }
      return { ...d, x2: p.x, y2: p.y };
    });
  };

  const onPointerUp = (): void => {
    if (!draft) return;
    const done = draft;
    setDraft(null);
    setHistory((h) => pushAnnotationOp(h, done)); // 无意义操作在 push 内过滤
  };

  const save = (): void => {
    if (!image || history.ops.length === 0 || saving) return;
    setSaving(true);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setSaving(false);
      toast.error('无法创建画布');
      return;
    }
    ctx.drawImage(image, 0, 0);
    replayAnnotationOps(ctx, history.ops, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setSaving(false);
        toast.error('导出图片失败');
        return;
      }
      onSave(new File([blob], annotatedFileName(name), { type: 'image/png' }));
    }, 'image/png');
  };

  const canvasEl = canvasRef.current;

  return (
    <div className="fixed inset-0 z-[82] flex flex-col bg-black/80 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="max-w-[60%] truncate text-13 text-white/70 select-none">
          标注 · {name} <span className="text-white/40">（标注将烧录进图片并替换附件）</span>
        </span>
        <button
          type="button"
          aria-label="关闭"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
        {error ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-13 text-white/80">读取图片失败：{error}</p>
            <button
              type="button"
              className="h-9 min-w-[88px] rounded-lg border border-white/20 px-3 text-13 text-white/80 hover:bg-white/10"
              onClick={onCancel}
            >
              关闭
            </button>
          </div>
        ) : !image ? (
          <Loader2 size={20} className="animate-spin text-white/70" />
        ) : (
          <>
            <canvas
              ref={canvasRef}
              width={image.naturalWidth}
              height={image.naturalHeight}
              className="block max-h-full max-w-full touch-none rounded-container object-contain shadow-2xl select-none"
              style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {textInput && canvasEl && (
              <input
                autoFocus
                value={textInput.value}
                onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                onBlur={commitTextInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTextInput();
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    e.preventDefault();
                    setTextInput(null);
                    textInputOpenRef.current = false;
                  }
                }}
                className="absolute z-10 rounded border border-white/60 bg-black/40 px-0.5 outline-none"
                style={{
                  left: canvasEl.offsetLeft + textInput.dx,
                  top: canvasEl.offsetTop + textInput.dy,
                  color,
                  caretColor: color,
                  fontSize: textInput.fontPx,
                  lineHeight: 1.1,
                  fontWeight: 600,
                  width: Math.min(
                    canvasEl.clientWidth * 0.8,
                    Math.max(80, (textInput.value.length + 2) * textInput.fontPx),
                  ),
                }}
              />
            )}
          </>
        )}
      </div>

      {/* 工具栏：工具 / 颜色 / 粗细 / 撤销重做清除 / 保存替换 */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-board bg-card px-3 py-2 shadow-[var(--shadow-menu)]">
          {TOOL_ITEMS.map(({ tool: t, label, Icon }) => (
            <button
              key={t}
              type="button"
              title={label}
              disabled={!image}
              onClick={() => setTool(t)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40',
                tool === t ? 'bg-hover text-primary' : 'text-muted hover:bg-hover hover:text-primary',
              )}
            >
              <Icon size={15} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-board" aria-hidden />
          {Object.values(ANNOTATION_COLORS).map((c) => (
            <button
              key={c}
              type="button"
              title={c === ANNOTATION_COLORS.red ? '红' : c === ANNOTATION_COLORS.yellow ? '黄' : '蓝'}
              onClick={() => setColor(c)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-hover',
                color === c && 'bg-hover',
              )}
            >
              <span
                className={cn('rounded-full border border-black/20', color === c && 'ring-2 ring-[var(--focus-ring)] ring-offset-2 ring-offset-card')}
                style={{ backgroundColor: c, width: 14, height: 14 }}
              />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-board" aria-hidden />
          {ANNOTATION_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              title={`粗细 ${w}`}
              onClick={() => setWidth(w)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-hover',
                width === w ? 'bg-hover text-primary' : 'text-muted hover:text-primary',
              )}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: w * 2, height: w * 2 }}
              />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-board" aria-hidden />
          <button
            type="button"
            title="撤销"
            disabled={history.ops.length === 0}
            onClick={() => setHistory(undoAnnotationOp)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary disabled:opacity-40"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            title="重做"
            disabled={history.redo.length === 0}
            onClick={() => setHistory(redoAnnotationOp)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary disabled:opacity-40"
          >
            <Redo2 size={15} />
          </button>
          <button
            type="button"
            title="清除全部标注"
            disabled={history.ops.length === 0}
            onClick={() => setHistory(clearAnnotations)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
          <span className="mx-1 h-5 w-px bg-board" aria-hidden />
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg border border-board px-3 text-13 text-secondary transition-colors hover:bg-hover"
          >
            取消
          </button>
          <button
            type="button"
            disabled={history.ops.length === 0 || saving}
            onClick={save}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-13 font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            保存并替换
          </button>
        </div>
      </div>
    </div>
  );
}
