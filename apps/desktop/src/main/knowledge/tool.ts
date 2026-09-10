/**
 * knowledge_search 工具的执行层：解析参数 → 检索 → 格式化为带来源的文本。
 * 与 search/tool.ts 同职责切分：本文件可依赖 store（主进程），MCP 协议层不依赖。
 */
import type { KnowledgeSearchResult } from '../../shared/knowledge.js';
import { resolveDefaultTopK, searchKnowledgeChunks } from './store.js';

export interface KnowledgeToolOutput {
  text: string;
  isError: boolean;
}

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

export function handleKnowledgeSearch(
  kbIds: string[],
  args: Record<string, unknown>,
): KnowledgeToolOutput {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return { text: '缺少检索词（query）。请把要查的问题原话作为 query 传入。', isError: true };
  }
  if (kbIds.length === 0) {
    return { text: '当前会话没有绑定知识库。', isError: true };
  }
  const rawLimit = typeof args.limit === 'number' ? Math.round(args.limit) : resolveDefaultTopK(kbIds);
  const limit = Math.min(Math.max(rawLimit || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const results: KnowledgeSearchResult[] = searchKnowledgeChunks(kbIds, query, limit);
  if (results.length === 0) {
    return {
      text: `知识库中没有找到与「${query}」相关的内容。请如实告知用户未命中，不要编造。`,
      isError: false,
    };
  }

  const body = results
    .map(
      (r, i) =>
        `【${i + 1}】来源：${r.docName}（第 ${r.ord} 块）\n${r.snippet}`,
    )
    .join('\n\n');
  const header = `本地知识库「${query}」命中 ${results.length} 条（按相关度排序）：`;
  const footer =
    '回答时如采用以上内容，请在对应句子后标注【n】并写明来源文档名；以上内容未覆盖的部分请如实说明。';
  return { text: `${header}\n\n${body}\n\n${footer}`, isError: false };
}
