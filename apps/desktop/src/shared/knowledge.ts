/**
 * 本地知识库共享常量与类型（纯关键词检索：FTS5 BM25，无 embedding/向量）。
 */

export const KNOWLEDGE_MCP_SERVER_NAME = 'knowledge';
export const KNOWLEDGE_MCP_TOOL_NAME = 'knowledge_search';

export interface KnowledgeBaseView {
  id: string;
  name: string;
  docCount: number;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeDocView {
  id: string;
  kbId: string;
  name: string;
  chunkCount: number;
  chars: number;
  createdAt: number;
}

export interface KnowledgeSearchResult {
  /** 来源文档名 */
  docName: string;
  /** 块序号（该文档内第几块，从 1 起） */
  ord: number;
  /** 命中片段（原文窗口） */
  snippet: string;
  /** BM25 相关度（越小越相关，仅排序用） */
  score: number;
}

export interface KnowledgeImportResult {
  name: string;
  ok: boolean;
  chunks?: number;
  error?: string;
}
