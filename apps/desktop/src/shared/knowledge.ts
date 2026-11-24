/**
 * 本地知识库共享常量与类型（纯语义检索：向量余弦 TopN，见 main/knowledge/embeddings.ts）。
 */

export const KNOWLEDGE_MCP_SERVER_NAME = 'knowledge';
export const KNOWLEDGE_MCP_TOOL_NAME = 'knowledge_search';
export const KNOWLEDGE_MCP_LIST_TOOL_NAME = 'knowledge_list';
export const KNOWLEDGE_MCP_DINGTALK_TOOL_NAME = 'dingtalk_kb_search';
export const KNOWLEDGE_MCP_WECOM_TOOL_NAME = 'wecom_doc_search';

/** KB 级检索/分块参数（MCP 默认 limit、导入分块都用它） */
export interface KnowledgeBaseParams {
  /** 检索返回条数 */
  topK: number;
  /** 分块目标长度（字符） */
  chunkSize: number;
  /** 相邻块重叠（字符） */
  chunkOverlap: number;
}

/** 会话绑定：勾选的库 + 是否发送前自动检索注入 */
export interface KnowledgeSessionBinding {
  ids: string[];
  auto: boolean;
  /**
   * 同时勾选「企业文档」检索：工具跟当前办公 CLI 供应商走——钉钉 = dingtalk_kb_search
   * （知识库 AI 搜索），企业微信 = wecom_doc_search（文档搜索）。字段名沿用 dingtalk
   * （存量会话绑定里存的就是这个键），语义已是两家通用。
   */
  dingtalk?: boolean;
}

export interface KnowledgeBaseView {
  id: string;
  name: string;
  docCount: number;
  chunkCount: number;
  /** 已向量化块数（语义检索就绪度；< chunkCount 时可回填升级） */
  embeddedChunks?: number;
  createdAt: number;
  params?: KnowledgeBaseParams;
}

export interface KnowledgeDocView {
  id: string;
  kbId: string;
  name: string;
  chunkCount: number;
  chars: number;
  createdAt: number;
  /** note = 手动笔记（可再编辑） */
  kind?: 'file' | 'note';
  /** 笔记原文（仅 note 有，编辑回填用） */
  noteContent?: string;
}

export interface KnowledgeSearchResult {
  /** 来源文档名 */
  docName: string;
  /** 块序号（该文档内第几块，从 1 起） */
  ord: number;
  /** 命中片段（原文窗口） */
  snippet: string;
  /** 余弦相似度（越大越相关，仅排序用） */
  score: number;
}

export interface KnowledgeImportResult {
  name: string;
  /** 原始路径（失败重试用） */
  path?: string;
  ok: boolean;
  chunks?: number;
  error?: string;
}
