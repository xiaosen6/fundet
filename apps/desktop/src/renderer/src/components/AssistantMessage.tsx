/**
 * AssistantMessage — 助手消息正文：react-markdown + GFM + 代码高亮。
 *
 * 流式渲染：store 的 100ms 节流控制频率；流式期间挂 streamWordFade 插件做
 * 逐词淡入（DESIGN.md §14.4 第五类 sanctioned motion 的简化版，详见
 * lib/streamWordFade.ts），reduced-motion 下不挂。终版渲染零 span 包装。
 */
import { memo, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkCjkFriendly from 'remark-cjk-friendly';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeMathDelimiters } from '../lib/mathMarkdown';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { isImagePath } from '../lib/artifacts';
import { createStreamFadeState, rehypeStreamWordFade, type StreamFadeState } from '../lib/streamWordFade';
import { LocalImagePreview, looksLikeFilePath } from './LocalImagePreview';
import { isMermaidClassName, MarkdownMermaidBlock } from './chat/MarkdownMermaidBlock';

interface AssistantMessageProps {
  text: string;
  /** 流式进行中：启用逐词淡入 */
  streaming?: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (typeof node === 'object' && node && 'props' in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

// 长会话里历史消息的 text/workDir/onOpenFile 都不变；不 memo 的话流式期间
// 每 100ms 全列表重渲染、react-markdown 重解析全部历史。
function AssistantMessageImpl({
  text,
  streaming,
  workDir,
  onOpenFile,
}: AssistantMessageProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  // 逐词淡入的时序账本：跨渲染存活（流式一轮一份；流式结束即丢弃，
  // 下一轮 turn 重新开播）。reduced-motion 时保持 null = 不挂插件。
  const fadeStateRef = useRef<StreamFadeState | null>(null);
  if (!streaming || reducedMotion) {
    fadeStateRef.current = null;
  } else if (fadeStateRef.current === null) {
    fadeStateRef.current = createStreamFadeState();
  }

  // 对齐 Cindy：() / [] 数学定界符规范化后交给 remark-math；
  // 快速通路（无 LaTeX 定界符）零成本原样返回。
  const normalizedText = normalizeMathDelimiters(text);

  const rehypePlugins =
    streaming && fadeStateRef.current
      ? [rehypeHighlight, rehypeStreamWordFade(fadeStateRef.current)]
      : [rehypeHighlight, rehypeKatex];

  return (
    <div className="md text-primary select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          pre: ({ children }) => {
            // ```mermaid 围栏 → SVG 图表（解析失败回落源码）
            const child = Array.isArray(children) ? children[0] : children;
            const cls = (child as { props?: { className?: string } } | undefined)?.props?.className;
            if (typeof cls === 'string' && isMermaidClassName(cls)) {
              const raw = flattenText((child as { props?: { children?: ReactNode } }).props?.children);
              return <MarkdownMermaidBlock raw={raw} />;
            }
            return <pre>{children}</pre>;
          },
          a: ({ href, children }) => (
            // http(s) 进系统浏览器；相对/本地路径走右侧 Canvas 预览。
            // 不拦截会让 Electron 主窗口整页跳走（will-navigate 还有一道主进程兜底）。
            <a
              href={href}
              className="cursor-pointer"
              onClick={(e) => {
                if (!href || href.startsWith('#')) return;
                e.preventDefault();
                if (/^https?:\/\//i.test(href)) void window.fundet.openExternal(href);
                else onOpenFile?.(href);
              }}
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const raw = flattenText(children).trim();
            const isBlock = Boolean(className) || raw.includes('\n');
            if (!isBlock && looksLikeFilePath(raw) && isImagePath(raw)) {
              return (
                <span className="my-2 block">
                  <button
                    type="button"
                    title="点击预览图片"
                    onClick={() => onOpenFile?.(raw)}
                    className="cursor-pointer font-mono text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
                  >
                    {raw}
                  </button>
                  {workDir ? (
                    <LocalImagePreview path={raw} workDir={workDir} onOpen={onOpenFile} />
                  ) : null}
                </span>
              );
            }
            return <code className={className}>{children}</code>;
          },
          img: ({ src, alt }) => {
            if (src && workDir && !/^https?:\/\//i.test(src) && !src.startsWith('data:')) {
              return <LocalImagePreview path={src} workDir={workDir} onOpen={onOpenFile} alt={alt} />;
            }
            return <img src={src} alt={alt} className="max-h-[360px] max-w-full rounded-inner object-contain" />;
          },
        }}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
