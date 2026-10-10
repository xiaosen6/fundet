/**
 * CanvasPane —— 右侧产物预览面板（v2，2026-09-30 对齐 Cindy 体感）。
 * - 可拖宽（280px..窗宽 70%，localStorage 持久化）+ 一键撑满/还原
 * - 头部：标题 + 当前文件名 + 撑满/关闭按钮（v1 的 onClose 是死代码，已激活）
 * - 产物列表：横向 pill 行（替代 140px 竖列表），activePath 变化自动滚入视口
 * - text/html 源码 highlight.js 高亮；HTML 轮末自动刷新（turnActive 转折 bump key）
 * - 空态设计化（图标 + 标题 + 描述）
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/common';
import {
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Music,
  PanelRight,
  Presentation,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { basename, type Artifact, type ArtifactKind } from '../lib/artifacts';
import { LocalImagePreview } from './LocalImagePreview';
import { OfficePreviewLoading } from './officePreviewShared';
import { buildFilePreviewUrl } from '../../../shared/file-preview-url.ts';

// Office 预览三件按需加载（xlsx/mammoth/jszip 体积可观，拆独立 chunk）
const DocxPreview = lazy(() => import('./DocxPreview'));
const XlsxPreview = lazy(() => import('./XlsxPreview'));
const PptxPreview = lazy(() => import('./PptxPreview'));

const WIDTH_KEY = 'fundet.canvas.width';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;

interface CanvasPaneProps {
  workDir: string;
  artifacts: Artifact[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
  /** 当前会话是否在跑（HTML 轮末自动刷新的信号） */
  turnActive: boolean;
}

function KindIcon({ kind }: { kind: ArtifactKind }): React.JSX.Element {
  const props = { size: 13 as const };
  if (kind === 'image') return <ImageIcon {...props} />;
  if (kind === 'video') return <Film {...props} />;
  if (kind === 'audio') return <Music {...props} />;
  if (kind === 'html') return <Globe {...props} />;
  if (kind === 'xlsx') return <FileSpreadsheet {...props} />;
  if (kind === 'pptx') return <Presentation {...props} />;
  return <FileText {...props} />;
}

function loadWidth(): number {
  const raw = window.localStorage.getItem(WIDTH_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= MIN_WIDTH ? Math.min(n, Math.floor(window.innerWidth * 0.7)) : DEFAULT_WIDTH;
}

/** 源码高亮：按扩展挑语言，失败回落纯文本 */
function highlightSource(text: string, path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    json: 'json', py: 'python', html: 'xml', htm: 'xml', xml: 'xml', css: 'css',
    sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', md: 'markdown', sql: 'sql',
    go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
  };
  const lang = langMap[ext];
  try {
    return lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
      : hljs.highlightAuto(text).value;
  } catch {
    return text;
  }
}

export function CanvasPane({
  workDir,
  artifacts,
  activePath,
  onSelect,
  onClose,
  turnActive,
}: CanvasPaneProps): React.JSX.Element {
  const active = artifacts.find((a) => a.path === activePath) ?? artifacts[0] ?? null;
  const [width, setWidth] = useState(loadWidth);
  const [maximized, setMaximized] = useState(false);
  const pillsRef = useRef<HTMLDivElement>(null);
  const prevTurnActiveRef = useRef(turnActive);
  // HTML 轮末自动刷新（Cindy useLocalHtmlAutoReload 简化版：turn 结束即 reload
  // 在看的 HTML，不区分是否真改过——v1 接受一次多余刷新）
  const [htmlReloadKey, setHtmlReloadKey] = useState(0);
  useEffect(() => {
    if (prevTurnActiveRef.current && !turnActive) setHtmlReloadKey((k) => k + 1);
    prevTurnActiveRef.current = turnActive;
  }, [turnActive]);

  // activePath 变化 → 对应 pill 滚入视口（点击消息里的文件能找到它在列表哪）
  useLayoutEffect(() => {
    if (!activePath || !pillsRef.current) return;
    const el = pillsRef.current.querySelector<HTMLElement>(`[data-path="${CSS.escape(activePath)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activePath, artifacts]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent): void => {
        const w = Math.min(Math.max(MIN_WIDTH, startW + (startX - ev.clientX)), Math.floor(window.innerWidth * 0.7));
        setWidth(w);
      };
      const onUp = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.localStorage.setItem(WIDTH_KEY, String(Math.round(Math.min(Math.max(MIN_WIDTH, startW + (startX - ev.clientX)), Math.floor(window.innerWidth * 0.7)))));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width],
  );

  return (
    <aside
      className={cn('relative flex h-full shrink-0 flex-col border-l border-board bg-surface', maximized ? 'flex-1 min-w-0' : null)}
      style={maximized ? undefined : { width }}
    >
      {/* 拖宽把手（撑满时隐藏） */}
      {!maximized && (
        <div
          onMouseDown={startResize}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="拖动调整宽度，双击复位"
          className="absolute top-0 bottom-0 -left-[3px] z-10 w-[6px] cursor-col-resize hover:bg-accent/30"
        />
      )}

      {/* 头部：标题 + 当前文件名 + 撑满/关闭 */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-board px-3">
        <PanelRight size={14} className="shrink-0 text-secondary" />
        <span className="shrink-0 text-13 font-medium text-primary">Canvas</span>
        {active && (
          <span className="min-w-0 flex-1 truncate text-12 text-muted" title={active.path}>
            {basename(active.path)}
          </span>
        )}
        {!active && <span className="flex-1" />}
        <button
          type="button"
          title={maximized ? '还原宽度' : '撑满内容区'}
          className="p-1 text-secondary hover:text-primary"
          onClick={() => setMaximized((v) => !v)}
        >
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button type="button" title="关闭 Canvas" className="p-1 text-secondary hover:text-primary" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {artifacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-board bg-chip text-secondary">
            <PanelRight size={18} />
          </div>
          <p className="text-13 font-medium text-primary">还没有可预览的产物</p>
          <p className="text-12 leading-relaxed text-secondary">
            助手写入或生成的文件（图片 / 网页 / 文档 / 代码）会出现在这里；
            也可以把文件拖进对话框。
          </p>
        </div>
      ) : (
        <>
          {/* 产物横 pill 行 */}
          <div ref={pillsRef} className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-board px-2 scrollbar-none">
            {artifacts.map((a) => (
              <button
                key={a.path}
                type="button"
                data-path={a.path}
                title={a.path}
                onClick={() => onSelect(a.path)}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-12 transition-colors',
                  a.path === active?.path
                    ? 'border-accent bg-accent text-card'
                    : 'border-transparent text-secondary hover:border-board hover:text-primary',
                )}
              >
                <KindIcon kind={a.kind} />
                <span className="max-w-[160px] truncate">{basename(a.path)}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {active ? <Preview workDir={workDir} artifact={active} htmlReloadKey={htmlReloadKey} /> : null}
          </div>
        </>
      )}
    </aside>
  );
}

function Preview({
  workDir,
  artifact,
  htmlReloadKey,
}: {
  workDir: string;
  artifact: Artifact;
  htmlReloadKey: number;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [htmlMode, setHtmlMode] = useState<'preview' | 'source'>('preview');
  const mediaUrl = buildFilePreviewUrl(workDir, artifact.path);

  const needsText =
    artifact.kind === 'text' ||
    artifact.kind === 'markdown' ||
    (artifact.kind === 'html' && htmlMode === 'source');

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError('');
    if (!needsText) return;
    const run = async (): Promise<void> => {
      try {
        const body = await window.fundet.readTextFile(artifact.path, workDir);
        if (!cancelled) setText(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [artifact.path, artifact.kind, workDir, needsText]);

  useEffect(() => {
    setHtmlMode('preview');
  }, [artifact.path]);

  const hlHtml = text !== null && artifact.kind !== 'markdown' ? highlightSource(text.slice(0, 80_000), artifact.path) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-13 font-medium text-primary">{basename(artifact.path)}</div>
          <div className="truncate font-mono text-11 text-muted" title={artifact.path}>
            {artifact.path}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {artifact.kind === 'html' ? (
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-11 text-secondary hover:bg-hover hover:text-primary"
              onClick={() => setHtmlMode((m) => (m === 'preview' ? 'source' : 'preview'))}
            >
              {htmlMode === 'preview' ? '源码' : '预览'}
            </button>
          ) : null}
          <button
            type="button"
            title="用系统打开"
            className="text-muted hover:text-primary"
            onClick={() => void window.fundet.openPath(artifact.path, workDir || undefined)}
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
      {error && <div className="text-12 text-error">{error}</div>}
      {artifact.kind === 'image' && (
        <LocalImagePreview path={artifact.path} workDir={workDir} maxHeight="100%" />
      )}
      {artifact.kind === 'video' && mediaUrl && (
        <video
          key={mediaUrl}
          controls
          className="max-h-full w-full rounded-inner border border-board bg-card"
          src={mediaUrl}
          onError={() => setError('无法内嵌播放这个视频，点右上角用系统打开。')}
        />
      )}
      {artifact.kind === 'audio' && mediaUrl && (
        <audio key={mediaUrl} controls className="w-full" src={mediaUrl} />
      )}
      {artifact.kind === 'html' && htmlMode === 'preview' && mediaUrl && (
        <iframe
          key={`${mediaUrl}#${htmlReloadKey}`}
          title={basename(artifact.path)}
          className="min-h-[240px] w-full flex-1 rounded-inner border border-board bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          src={mediaUrl}
        />
      )}
      {artifact.kind === 'pdf' && mediaUrl && (
        <iframe
          title={basename(artifact.path)}
          className="min-h-[240px] w-full flex-1 rounded-inner border border-board bg-card"
          src={mediaUrl}
        />
      )}
      {(artifact.kind === 'docx' || artifact.kind === 'xlsx' || artifact.kind === 'pptx') && (
        <Suspense fallback={<OfficePreviewLoading label="加载预览…" />}>
          {artifact.kind === 'docx' && <DocxPreview path={artifact.path} workDir={workDir} />}
          {artifact.kind === 'xlsx' && <XlsxPreview path={artifact.path} workDir={workDir} />}
          {artifact.kind === 'pptx' && <PptxPreview path={artifact.path} workDir={workDir} />}
        </Suspense>
      )}
      {artifact.kind === 'markdown' && text !== null && (
        <div className="md min-h-0 flex-1 overflow-auto rounded-inner border border-board bg-card p-3 text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text.slice(0, 80_000)}</ReactMarkdown>
        </div>
      )}
      {hlHtml !== null && (
        <pre className="flex-1 overflow-auto rounded-inner border border-board bg-card p-2 font-mono text-11 leading-[1.5] whitespace-pre-wrap text-primary">
          <code dangerouslySetInnerHTML={{ __html: hlHtml }} />
          {text !== null && text.length > 80_000 ? '\n…' : ''}
        </pre>
      )}
      {!error && artifact.kind === 'other' && (
        <p className="text-12 text-muted">这种文件不能内嵌预览，点右上角用系统打开。</p>
      )}
      {!error && !mediaUrl && (artifact.kind === 'video' || artifact.kind === 'html' || artifact.kind === 'pdf') && (
        <p className="text-12 text-muted">文件不在当前工作目录内，无法内嵌预览。点右上角用系统打开。</p>
      )}
    </div>
  );
}
