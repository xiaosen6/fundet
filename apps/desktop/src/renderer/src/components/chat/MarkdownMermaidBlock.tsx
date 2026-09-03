/**
 * MarkdownMermaidBlock —— 把 ```mermaid 围栏块渲染成 SVG 图表（对齐 Cindy 的
 * MarkdownMermaidBlock 核心行为，轻量版）。
 *
 * - 动态 import('mermaid')：未用到 mermaid 的会话不加载 ~1MB 依赖。
 * - 流式：半截语法解析失败静默回落源码视图，语法合法后下次渲染自动换 SVG。
 * - 主题：MutationObserver 盯 <html class="dark">，明暗主题自动重渲染。
 */
import { memo, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;

async function loadMermaid(dark: boolean): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
      return m.default;
    });
  }
  return mermaidPromise;
}

function MarkdownMermaidBlockImpl({ raw }: { raw: string }): React.JSX.Element {
  const isDark = useRef(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewSource, setViewSource] = useState(false);
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const themeRef = useRef(detectDark());

  function detectDark(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  }

  useEffect(() => {
    let cancelled = false;
    const dark = detectDark();
    themeRef.current = dark;
    (async () => {
      try {
        const mermaid = await loadMermaid(dark);
        const { svg: svgText } = await mermaid.render(`mermaid-${renderId}-${Date.now()}`, raw);
        if (!cancelled) {
          setSvg(svgText);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, renderId]);

  // 主题切换重渲染
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark = detectDark();
      if (dark === themeRef.current) return;
      themeRef.current = dark;
      mermaidPromise = null; // 让下次 loadMermaid 按新主题 initialize
      setViewSource(false);
      setSvg(null);
      setFailed(false);
      // 触发重渲染：复用主 effect 的依赖不含 theme，这里手动再渲染一次
      (async () => {
        try {
          const mermaid = await loadMermaid(dark);
          const { svg: svgText } = await mermaid.render(`mermaid-${renderId}-${Date.now()}`, raw);
          setSvg(svgText);
          setFailed(false);
        } catch {
          setSvg(null);
          setFailed(true);
        }
      })();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [raw, renderId]);

  if (failed || viewSource || !svg) {
    return (
      <div className="my-2 overflow-hidden rounded-container border border-board">
        <div className="border-b border-board bg-chip px-3 py-1 text-11 text-secondary">mermaid{failed ? ' · 语法暂不完整，显示源码' : ''}</div>
        <pre className="overflow-x-auto px-3 py-2 text-13">
          <code className={cn(!failed && 'cursor-pointer')} onClick={failed ? undefined : () => setViewSource(true)}>{raw}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-container border border-board">
      <div className="flex items-center justify-between border-b border-board bg-chip px-3 py-1">
        <span className="text-11 text-secondary">mermaid</span>
        <button type="button" className="text-11 text-secondary hover:text-primary" onClick={() => setViewSource(true)}>
          源码
        </button>
      </div>
      <div className="overflow-x-auto px-3 py-2" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export const MarkdownMermaidBlock = memo(MarkdownMermaidBlockImpl);

/** 判断 pre 的 code 子元素是否 mermaid 语言块（对齐 Cindy isMermaidCodeChild）。 */
export function isMermaidClassName(className?: string): boolean {
  return /\b(language-)?mermaid\b/.test(className ?? '');
}
