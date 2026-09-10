/**
 * 知识库引用溯源（⑤）：从 knowledge_search 工具输出解析来源清单，
 * 并提供 rehype 插件把助手回复里的【n】标记替换成可点角标。
 *
 * 工具输出格式（knowledge/tool.ts 约定）：
 *   【1】来源：文档名（第 2 块）
 *   片段文本…
 */

export interface KnowledgeSource {
  n: number;
  docName: string;
  ord: number;
  snippet: string;
}

/** 解析 knowledge_search 工具输出里的来源清单（【n】来源：名（第 x 块）+ 片段） */
export function parseKnowledgeSources(toolText: string): KnowledgeSource[] {
  const out: KnowledgeSource[] = [];
  const re = /【(\d{1,2})】来源：(.+?)（第 (\d+) 块）\n([\s\S]*?)(?=\n\n【\d{1,2}】|$)/g;
  for (const m of toolText.matchAll(re)) {
    out.push({
      n: Number(m[1]),
      docName: m[2]!.trim(),
      ord: Number(m[3]),
      snippet: m[4]!.trim(),
    });
  }
  return out;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** 正文文本里的引用标记：【n】 */
const CITE_RE = /【(\d{1,2})】/g;

/**
 * rehype 插件：把文本节点里的【n】切成 sup.kb-cite（data-n = n）。
 * 只处理来源清单里存在的 n（未知的当普通文本）。最终渲染由
 * AssistantMessage 的 components.sup 接成可点角标。
 */
export function rehypeKnowledgeCite(sources: KnowledgeSource[]) {
  const known = new Set(sources.map((s) => s.n));
  return () => (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (!node.children) return;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i]!;
        if (child.type === 'text' && child.value && child.value.includes('【')) {
          const parts: Array<{ text?: string; n?: number }> = [];
          let last = 0;
          for (const m of child.value.matchAll(CITE_RE)) {
            const n = Number(m[1]);
            if (!known.has(n)) continue;
            const idx = m.index ?? 0;
            if (idx > last) parts.push({ text: child.value.slice(last, idx) });
            parts.push({ n });
            last = idx + m[0].length;
          }
          if (parts.length === 0) continue;
          if (last < child.value.length) parts.push({ text: child.value.slice(last) });
          const replacement: HastNode[] = parts.map((p) =>
            p.n !== undefined
              ? {
                  type: 'element',
                  tagName: 'sup',
                  properties: { className: ['kb-cite'], dataN: String(p.n) },
                  children: [{ type: 'text', value: String(p.n) }],
                }
              : { type: 'text', value: p.text ?? '' },
          );
          node.children.splice(i, 1, ...replacement);
          continue;
        }
        if (child.type === 'element') walk(child);
      }
    };
    walk(tree);
  };
}
