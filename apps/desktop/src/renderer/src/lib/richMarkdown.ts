/**
 * 富 Markdown 插件懒加载（内存批 P3）：katex（~280KB）+ rehype-highlight
 * （lowlight/highlight.js ~1MB）此前静态进主 chunk，每次启动都解析执行。
 * 改为：正文嗅探到数学/代码围栏时按需动态加载，全应用共享一份，加载完成
 * 前以轻量插件组渲染（无高亮/公式，纯文本可读）。
 * katex.min.css（~23KB，字体按需另拉）保持静态——体积远小于 JS 引擎。
 */
import 'katex/dist/katex.min.css';

type RehypePlugin = unknown;

let loaded: RehypePlugin[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** ReactMarkdown 的 Pluggable 形态（调用点 as 断言收窄）。 */
export type RichRehypePair = { highlight: unknown; katex: unknown } | null;

export function getRichRehype(): RichRehypePair {
  if (!loaded || loaded.length < 2) return null;
  return { highlight: loaded[0], katex: loaded[1] };
}

/** 订阅加载完成（组件重渲染用）；返回退订。 */
export function subscribeRichRehype(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 按需加载（幂等）：正文含代码围栏或数学定界符时调用。 */
export function ensureRichRehype(): void {
  if (loaded || loading) return;
  loading = (async () => {
    const [highlightMod, katexMod] = await Promise.all([
      import('rehype-highlight'),
      import('rehype-katex'),
    ]);
    loaded = [highlightMod.default, katexMod.default];
    for (const l of listeners) l();
  })().catch(() => {
    loading = null; // 失败允许下次重试
  });
}

/** 正文嗅探：代码围栏 / 数学定界符（粗判，误报只是多加载一次）。 */
export function textNeedsRichMarkdown(text: string): boolean {
  return /```|~~~/.test(text) || /\$[^$\n]|\$\$|\\\(|\\\[/.test(text);
}
