/**
 * Tavily / Brave / 博查 / 智谱 Web Search HTTP。
 * fetchImpl 可注入，单测不打真网。
 */
import type { SearchEngineId, SearchHit, SearchResult } from '../../shared/search-engines.ts';

const TIMEOUT_MS = 20_000;

export type SearchFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string }>;

const defaultFetch: SearchFetch = async (url, init) => {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hitFromUnknown(value: unknown): SearchHit | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const url = str(rec.url) || str(rec.link) || str(rec.href);
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  const title = str(rec.title) || str(rec.name) || url;
  const snippet =
    str(rec.snippet) || str(rec.content) || str(rec.description) || str(rec.summary) || '';
  return { title, url, snippet };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function httpError(engine: string, status: number, body: string): SearchResult {
  const clip = body.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (status === 401 || status === 403) {
    return { ok: false, error: `${engine} 鉴权失败（HTTP ${status}）。请检查设置里的 API key。` };
  }
  if (status === 429) {
    return { ok: false, error: `${engine} 额度用尽或请求过快（HTTP 429）。` };
  }
  return { ok: false, error: `${engine} 失败 HTTP ${status}${clip ? `：${clip}` : ''}` };
}

export function parseTavilyBody(raw: unknown, limit: number): SearchHit[] {
  const rec = asRecord(raw);
  const list = Array.isArray(rec?.results) ? rec.results : [];
  return list.map(hitFromUnknown).filter((h): h is SearchHit => h !== null).slice(0, limit);
}

export function parseBraveBody(raw: unknown, limit: number): SearchHit[] {
  const rec = asRecord(raw);
  const web = asRecord(rec?.web);
  const list = Array.isArray(web?.results) ? web.results : [];
  return list.map(hitFromUnknown).filter((h): h is SearchHit => h !== null).slice(0, limit);
}

export function parseBochaBody(raw: unknown, limit: number): SearchHit[] {
  const rec = asRecord(raw);
  const data = asRecord(rec?.data) ?? rec;
  const pages = asRecord(data?.webPages);
  const list = Array.isArray(pages?.value) ? pages.value : Array.isArray(data?.webPages) ? data.webPages : [];
  return list.map(hitFromUnknown).filter((h): h is SearchHit => h !== null).slice(0, limit);
}

export function parseZhipuBody(raw: unknown, limit: number): SearchHit[] {
  const rec = asRecord(raw);
  const list = Array.isArray(rec?.search_result)
    ? rec.search_result
    : Array.isArray(rec?.search_results)
      ? rec.search_results
      : [];
  return list.map(hitFromUnknown).filter((h): h is SearchHit => h !== null).slice(0, limit);
}

export async function searchWithEngine(
  engine: SearchEngineId,
  apiKey: string,
  query: string,
  limit: number,
  fetchImpl: SearchFetch = defaultFetch,
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'query 不能为空' };
  const n = Math.min(10, Math.max(1, Math.floor(limit) || 5));
  const key = apiKey.trim();
  if (!key) return { ok: false, error: `未配置 ${engine} 的 API key` };

  try {
    if (engine === 'tavily') {
      const res = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: q,
          max_results: n,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
      });
      if (res.status !== 200) return httpError('Tavily', res.status, res.text);
      return { ok: true, engine, results: parseTavilyBody(parseJson(res.text), n) };
    }

    if (engine === 'brave') {
      const url =
        'https://api.search.brave.com/res/v1/web/search?q=' +
        encodeURIComponent(q) +
        '&count=' +
        String(n);
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': key,
        },
      });
      if (res.status !== 200) return httpError('Brave', res.status, res.text);
      return { ok: true, engine, results: parseBraveBody(parseJson(res.text), n) };
    }

    if (engine === 'bocha') {
      const bochaInit = {
        method: 'POST' as const,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: q, count: n, summary: true }),
      };
      // 官方现域 api.bochaai.com；旧文档仍写 api.bocha.cn。鉴权失败不换域，避免连打两家额度。
      const bochaUrls = [
        'https://api.bochaai.com/v1/web-search',
        'https://api.bocha.cn/v1/web-search',
      ];
      let last: SearchResult | null = null;
      for (const url of bochaUrls) {
        const res = await fetchImpl(url, bochaInit);
        if (res.status === 200) {
          return { ok: true, engine, results: parseBochaBody(parseJson(res.text), n) };
        }
        last = httpError('博查', res.status, res.text);
        if (res.status === 401 || res.status === 403 || res.status === 429) return last;
      }
      return last ?? { ok: false, error: '博查搜索失败' };
    }

    const res = await fetchImpl('https://open.bigmodel.cn/api/paas/v4/web_search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search_query: q.slice(0, 70),
        search_engine: 'search_std',
        search_intent: false,
        count: n,
        content_size: 'medium',
      }),
    });
    if (res.status !== 200) return httpError('智谱', res.status, res.text);
    return { ok: true, engine, results: parseZhipuBody(parseJson(res.text), n) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Timeout') || msg.includes('aborted')) {
      return { ok: false, error: `${engine} 搜索超时` };
    }
    return { ok: false, error: `${engine} 网络失败：${msg}` };
  }
}
