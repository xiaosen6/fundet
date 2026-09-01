import { searchEngineMeta } from '../../shared/search-engines.ts';
import { readSearchKey, resolveSearchEngine } from './config.ts';
import type { SearchToolOutput } from './mcp-server.ts';
import { searchWithEngine } from './providers.ts';
import { brand } from '../../shared/brand.ts';

/** 内置 MCP `web_search` 的执行体；设置页测试走同一套 HTTP 客户端。 */
export async function handleWebSearch(args: Record<string, unknown>): Promise<SearchToolOutput> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { text: 'query 不能为空', isError: true };
  const engine = resolveSearchEngine(typeof args.engine === 'string' ? args.engine : null);
  if (!engine) {
    return {
      text: `还没有配置搜索引擎。请打开 ${brand.name} 「设置 → 搜索」，填写 Tavily、Brave、博查或智谱 Web Search 的 API key，然后重开对话。`,
      isError: true,
    };
  }
  const key = readSearchKey(engine);
  if (!key) {
    return { text: `${searchEngineMeta(engine).name} 的 API key 未配置。请到「设置 → 搜索」填写。`, isError: true };
  }
  const limit = typeof args.limit === 'number' ? args.limit : 5;
  const outcome = await searchWithEngine(engine, key, query, limit);
  if (!outcome.ok) return { text: outcome.error, isError: true };
  return {
    text: JSON.stringify(
      {
        engine: outcome.engine,
        results: outcome.results,
        note: `经 ${searchEngineMeta(outcome.engine).name} 搜索到 ${outcome.results.length} 条。需要正文时再用 bash curl 打开 URL。`,
      },
      null,
      2,
    ),
    isError: false,
  };
}
