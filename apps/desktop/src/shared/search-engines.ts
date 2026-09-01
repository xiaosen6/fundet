/** 与聊天模型脱钩的搜索引擎（方案 D）。 */

export const SEARCH_ENGINE_IDS = ['tavily', 'brave', 'bocha', 'zhipu'] as const;
export type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number];

/** cindy-bridge 注册名 → 模型侧工具 `mcp__search__web_search` */
export const SEARCH_MCP_SERVER_NAME = 'search';
export const SEARCH_MCP_TOOL_NAME = 'web_search';

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return typeof value === 'string' && (SEARCH_ENGINE_IDS as readonly string[]).includes(value);
}

export interface SearchEngineMeta {
  id: SearchEngineId;
  name: string;
  hint: string;
  signupUrl: string;
  secretId: string;
}

export const SEARCH_ENGINES: readonly SearchEngineMeta[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    hint: '给模型用的摘要搜索，tvly- 开头。每月约有免费额度。',
    signupUrl: 'https://app.tavily.com/home',
    secretId: 'search-tavily',
  },
  {
    id: 'brave',
    name: 'Brave',
    hint: '独立索引。控制台创建 Search API key。',
    signupUrl: 'https://api-dashboard.search.brave.com/app/keys',
    secretId: 'search-brave',
  },
  {
    id: 'bocha',
    name: '博查',
    hint: '中文网页搜索，开放平台 API Key。',
    signupUrl: 'https://open.bochaai.com',
    secretId: 'search-bocha',
  },
  {
    id: 'zhipu',
    name: '智谱 Web Search',
    hint: '智谱开放平台 key（可与聊天不是同一把）。',
    signupUrl: 'https://open.bigmodel.cn',
    secretId: 'search-zhipu',
  },
];

export function searchEngineMeta(id: SearchEngineId): SearchEngineMeta {
  return SEARCH_ENGINES.find((e) => e.id === id)!;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  ok: true;
  engine: SearchEngineId;
  results: SearchHit[];
}

export interface SearchFailure {
  ok: false;
  error: string;
}

export type SearchResult = SearchOutcome | SearchFailure;
