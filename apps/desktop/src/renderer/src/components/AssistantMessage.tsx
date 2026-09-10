/**
 * AssistantMessage — 助手消息正文：react-markdown + GFM + 代码高亮。
 *
 * 流式渲染（对齐 Cindy MarkdownRenderer 三层限频）：
 * - store 的 32ms 帧级合帧控制频率；
 * - 全文先 repairStreamingMarkdown（补未闭合围栏/摘半截链接）再按顶层块
 *   splitStreamingMarkdownChunks 切块，每块 memo —— 稳定前缀块保留解析结果
 *   与 DOM，只有尾块重进 parse/高亮链（长回答流式后期不再全文重 parse）；
 * - 逐词淡入（lib/streamWordFade）只挂尾块，按块位号独立账本；块内容稳定后
 *   连同账本一起冻结，不重播。reduced-motion 下整条链不挂。
 * 终版渲染单次 ReactMarkdown 原文，零 span 包装。
 */
import { memo, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
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
import { repairStreamingMarkdown, splitStreamingMarkdownChunks } from '../lib/streamingMarkdown';
import { LocalImagePreview, looksLikeFilePath } from './LocalImagePreview';
import { isMermaidClassName, MarkdownMermaidBlock } from './chat/MarkdownMermaidBlock';

interface AssistantMessageProps {
  text: string;
  /** 流式进行中：启用分块渲染 + 逐词淡入 */
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

const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly, remarkMath];

type MarkdownCallbacks = {
  workDir?: string;
  onOpenFile?: (path: string) => void;
};

/** 长会话里历史消息的 text/workDir/onOpenFile 都不变；不 memo 的话流式期间
 * 每次通知全列表重渲染、react-markdown 重解析全部历史。 */
function AssistantMessageImpl({
  text,
  streaming,
  workDir,
  onOpenFile,
}: AssistantMessageProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const streamingOn = streaming === true && !reducedMotion;

  // 回调经 ref 中转成稳定引用：分块 memo 的比较器只看内容，交互回调永远最新
  const callbacksRef = useRef<MarkdownCallbacks>({ workDir, onOpenFile });
  callbacksRef.current = { workDir, onOpenFile };

  // 逐词淡入账本：跨渲染存活（流式一轮一份；流式结束即丢弃，下一轮 turn 重新开播）。
  // 分块渲染下按「块位号 → 账本」，只有尾块挂插件；块位号内容稳定后账本随之冻结。
  const fadeStateRef = useRef<StreamFadeState | null>(null);
  const fadeStatesByChunkRef = useRef<Map<number, StreamFadeState>>(new Map());
  if (!streamingOn) {
    fadeStateRef.current = null;
    fadeStatesByChunkRef.current.clear();
  } else if (fadeStateRef.current === null) {
    fadeStateRef.current = createStreamFadeState();
  }

  // 对齐 Cindy：() / [] 数学定界符规范化后交给 remark-math；
  // 快速通路（无 LaTeX 定界符）零成本原样返回。流式先做结构修复（终版不修）。
  const normalizedText = streamingOn
    ? normalizeMathDelimiters(repairStreamingMarkdown(text))
    : normalizeMathDelimiters(text);

  const chunks = useMemo(
    () => (streamingOn ? splitStreamingMarkdownChunks(normalizedText) : null),
    [streamingOn, normalizedText],
  );

  if (!streamingOn || chunks === null) {
    return (
      <div className="md text-primary select-text">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={buildMarkdownComponents(callbacksRef)}
        >
          {normalizedText}
        </ReactMarkdown>
      </div>
    );
  }

  const last = chunks.length - 1;
  return (
    <div className="md text-primary select-text">
      {chunks.map((chunk, i) => (
        <StreamingMarkdownChunk
          key={i}
          text={chunk}
          isLast={i === last}
          fadeState={
            i === last
              ? (fadeStatesByChunkRef.current.get(i) ??
                createAndKeep(fadeStatesByChunkRef.current, i))
              : undefined
          }
          callbacksRef={callbacksRef}
        />
      ))}
    </div>
  );
}

function createAndKeep(map: Map<number, StreamFadeState>, index: number): StreamFadeState {
  let state = map.get(index);
  if (!state) {
    state = createStreamFadeState();
    map.set(index, state);
    // 只留最近几块的账本，防长回复积累
    if (map.size > 8) {
      const first = map.keys().next().value;
      if (first !== undefined) map.delete(first);
    }
  }
  return state;
}

/** 单块渲染：memo 后内容不变的前缀块跳过整条 parse/高亮链。 */
const StreamingMarkdownChunk = memo(function StreamingMarkdownChunk({
  text,
  isLast,
  fadeState,
  callbacksRef,
}: {
  text: string;
  isLast: boolean;
  fadeState?: StreamFadeState;
  callbacksRef: React.RefObject<MarkdownCallbacks>;
}): React.JSX.Element {
  const rehypePlugins =
    isLast && fadeState ? [rehypeHighlight, rehypeStreamWordFade(fadeState)] : [rehypeHighlight];
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={buildMarkdownComponents(callbacksRef)}
    >
      {text}
    </ReactMarkdown>
  );
});

/** markdown 元素级定制：回调从 ref 中转（引用稳定，行为永远取最新）。 */
function buildMarkdownComponents(callbacksRef: React.RefObject<MarkdownCallbacks>): Components {
  const { workDir, onOpenFile } = callbacksRef.current;
  return {
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
  };
}

export const AssistantMessage = memo(AssistantMessageImpl);
