/**
 * knowledge_search 工具的执行层：解析参数 → 检索 → 格式化为带来源的文本。
 * 与 search/tool.ts 同职责切分：本文件可依赖 store（主进程），MCP 协议层不依赖。
 */
import type { KnowledgeSearchResult } from '../../shared/knowledge.js';
import { resolveDefaultTopK, searchKnowledgeChunks, listKnowledgeBases, listKnowledgeDocs } from './store.js';

/** 自动注入（④）：检索结果 → 拼进用户消息前的上下文块 */
export function formatKnowledgeContextBlock(results: KnowledgeSearchResult[]): string {
  const body = results
    .map((r, i) => `【${i + 1}】来源：${r.docName}（第 ${r.ord} 块）\n${r.snippet}`)
    .join('\n\n');
  return (
    '[以下为本机知识库自动检索结果，供本次回答参考]\n\n' +
    body +
    '\n[检索结果结束] 请优先依据以上内容回答并在对应句子标注【n】与来源文档名；以上未覆盖的部分请如实说明，不要编造。'
  );
}

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

/** knowledge_list：列出会话绑定的本地知识库与文档清单（"知识库里有什么"类
 * 问题用这个，不要拿开放问题去 FTS 硬检索）。 */
export function handleKnowledgeList(kbIds: string[]): KnowledgeToolOutput {
  if (kbIds.length === 0) {
    return { text: '当前会话没有绑定知识库。', isError: true };
  }
  const all = listKnowledgeBases().filter((kb) => kbIds.includes(kb.id));
  if (all.length === 0) {
    return { text: '绑定的知识库已不存在（可能被删除）。', isError: true };
  }
  const lines: string[] = [];
  for (const kb of all) {
    const docs = listKnowledgeDocs(kb.id);
    lines.push(`## ${kb.name}（${docs.length} 份文档）`);
    if (docs.length === 0) {
      lines.push('（空）');
      continue;
    }
    for (const d of docs) {
      const kind = d.kind === 'note' ? ' [笔记]' : '';
      lines.push(`- ${d.name}${kind}（${d.chunkCount} 块 / ${d.chars} 字）`);
    }
  }
  const header = `本会话绑定了 ${all.length} 个本地知识库：`;
  const footer =
    '用户问"知识库里有什么/有哪些文档"时直接把上面的清单告诉用户；' +
    '要查具体内容再用 knowledge_search 检索。';
  return { text: `${header}\n\n${lines.join('\n')}\n\n${footer}`, isError: false };
}
