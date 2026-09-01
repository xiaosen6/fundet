/**
 * 从供应商列模型端点拉清单（对齐 Cindy provider-model-fetch 的精简版）。
 * OpenAI / Anthropic 常见形状：{ data: [{id}] } 或 { models: [{id}] }。
 */
import { readProviderKey } from './secrets.js';
import type { ProviderApi } from '../../shared/fundet-api.js';
import {
  extractDeclaredContextWindow,
  preferScannedContextWindow,
} from '../../shared/context-window.js';

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface FetchModelsInput {
  baseUrl: string;
  api: ProviderApi;
  apiKey?: string;
  providerId?: string;
}

export interface FetchModelsResult {
  ok: boolean;
  models?: DiscoveredModel[];
  error?: string;
}

const FETCH_TIMEOUT_MS = 15_000;

export function deriveModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hash = '';
  let pathname = url.pathname;
  while (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  url.pathname = /\/v\d+$/i.test(pathname)
    ? `${pathname}/models`
    : `${pathname === '/' ? '' : pathname}/v1/models`;
  return url.toString();
}

export function parseModelsListResponse(json: unknown): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { data?: unknown; models?: unknown };
  const list = Array.isArray(o.data) ? o.data : Array.isArray(o.models) ? o.models : null;
  if (!list) return null;
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ? (item as { id: string }).id
          : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const name =
      rec && typeof rec.display_name === 'string' && rec.display_name
        ? rec.display_name
        : rec && typeof rec.name === 'string' && rec.name
          ? rec.name
          : id;
    const contextWindow = preferScannedContextWindow(id, extractDeclaredContextWindow(rec));
    out.push({ id, name, ...(contextWindow ? { contextWindow } : {}) });
  }
  return out.length > 0 ? out : null;
}

export async function fetchProviderModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) return { ok: false, error: '请先填写 Base URL' };
  let url: string;
  try {
    url = deriveModelsUrl(baseUrl);
  } catch {
    return { ok: false, error: 'Base URL 无效' };
  }
  let apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey && input.providerId) {
    apiKey = readProviderKey(input.providerId)?.trim() ?? '';
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.api === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) {
      headers['x-api-key'] = apiKey;
      headers.authorization = `Bearer ${apiKey}`;
    }
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: `无法连接列模型端点：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    return { ok: false, error: `列模型失败 HTTP ${res.status}${body ? `：${body}` : ''}` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: '列模型响应不是 JSON' };
  }
  const models = parseModelsListResponse(json);
  if (!models) return { ok: false, error: '端点没有返回可识别的模型列表，请手动填写模型 id' };
  return { ok: true, models };
}
