import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ExternalLink,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Music,

} from 'lucide-react';
import { cn } from '../lib/cn';
import { basename, type Artifact, type ArtifactKind } from '../lib/artifacts';
import { LocalImagePreview } from './LocalImagePreview';
import { buildFilePreviewUrl } from '../../../shared/file-preview-url.ts';

interface CanvasPaneProps {
  workDir: string;
  artifacts: Artifact[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function KindIcon({ kind }: { kind: ArtifactKind }): React.JSX.Element {
  const props = { size: 13 as const };
  if (kind === 'image') return <ImageIcon {...props} />;
  if (kind === 'video') return <Film {...props} />;
  if (kind === 'audio') return <Music {...props} />;
  if (kind === 'html') return <Globe {...props} />;
  return <FileText {...props} />;
}

export function CanvasPane({
  workDir,
  artifacts,
  activePath,
  onSelect,
  onClose,
}: CanvasPaneProps): React.JSX.Element {
  const active = artifacts.find((a) => a.path === activePath) ?? artifacts[0] ?? null;

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-board bg-surface">
      <div className="flex h-[46px] shrink-0 items-center border-b border-board px-3">
        <span className="text-13 font-medium text-primary">Canvas</span>
      </div>
      {artifacts.length === 0 ? (
        <div className="px-4 py-8 text-13 text-muted">
          把文件拖进对话框，或等助手写入文件后，会出现在这里。
        </div>
      ) : (
        <>
          <div className="max-h-[140px] shrink-0 overflow-y-auto border-b border-board py-1">
            {artifacts.map((a) => (
              <button
                key={a.path}
                type="button"
                onClick={() => onSelect(a.path)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-12',
                  a.path === active?.path ? 'bg-hover text-primary' : 'text-secondary hover:bg-hover-soft',
                )}
                title={a.path}
              >
                <KindIcon kind={a.kind} />
                <span className="min-w-0 truncate">{basename(a.path)}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {active ? <Preview workDir={workDir} artifact={active} /> : null}
          </div>
        </>
      )}
    </aside>
  );
}

function Preview({ workDir, artifact }: { workDir: string; artifact: Artifact }): React.JSX.Element {
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
            onClick={() => void window.fundet.openPath(artifact.path)}
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
      {artifact.kind === 'markdown' && text !== null && (
        <div className="md min-h-0 flex-1 overflow-auto rounded-inner border border-board bg-card p-3 text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text.slice(0, 80_000)}</ReactMarkdown>
        </div>
      )}
      {text !== null && artifact.kind !== 'markdown' && (
        <pre className="flex-1 overflow-auto rounded-inner border border-board bg-card p-2 font-mono text-11 leading-[1.5] whitespace-pre-wrap text-primary">
          {text.slice(0, 80_000)}
          {text.length > 80_000 ? '\n…' : ''}
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
