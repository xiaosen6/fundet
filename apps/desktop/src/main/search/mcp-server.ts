/**
 * 内置搜索 MCP：localhost streamable-HTTP，注入 pi cindy-bridge。
 * 工具名 web_search → 模型侧 mcp__search__web_search。
 *
 * 不在此文件 import 密钥/Electron，便于 node --test 直接打协议。
 */
import { createServer, type Server } from 'node:http';
import { brand } from '../../shared/brand.ts';
import {
  SEARCH_ENGINE_IDS,
  SEARCH_MCP_TOOL_NAME,
} from '../../shared/search-engines.ts';

/** 避免测试依赖 @fundet/agent-core 的运行时解析。 */
type SearchMcpLogger = {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
};

const BODY_MAX = 1 * 1024 * 1024;

export interface SearchToolOutput {
  text: string;
  isError: boolean;
}

export type SearchToolHandler = (args: Record<string, unknown>) => Promise<SearchToolOutput>;

const TOOL = {
  name: SEARCH_MCP_TOOL_NAME,
  description:
    `使用用户在 ${brand.name} 「设置 → 搜索」里配置的引擎搜索公网，返回标题、链接、摘要。` +
    '用户说搜一下、查资料、最新新闻、找网页时调用。' +
    'engine 可省略（用设置里的默认）；可选 tavily、brave、bocha、zhipu。' +
    '未配置任何 key 时会返回指引，把 message 原样告诉用户去设置页填写。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索词，尽量用用户原话，不要扩写' },
      engine: {
        type: 'string',
        enum: [...SEARCH_ENGINE_IDS],
        description: '可选。tavily / brave / bocha / zhipu',
      },
      limit: { type: 'number', description: '条数，默认 5，最大 10' },
    },
    required: ['query'],
  },
};

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function dispatch(
  msg: { id?: unknown; method?: string; params?: unknown },
  searchHandler: SearchToolHandler,
): Promise<unknown> {
  const id = msg.id;
  const method = msg.method ?? '';
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fundet-search', version: '1.0.0' },
      },
    };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [TOOL] } };
  }
  if (method === 'tools/call') {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== SEARCH_MCP_TOOL_NAME) {
      return jsonRpcError(id, -32601, `unknown tool: ${params.name ?? ''}`);
    }
    const out = await searchHandler(params.arguments ?? {});
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: out.text }],
        isError: out.isError,
      },
    };
  }
  if (id === undefined || id === null) return null;
  return jsonRpcError(id, -32601, `unknown method: ${method}`);
}

export function startSearchMcpServer(
  token: string,
  logger: SearchMcpLogger,
  searchHandler: SearchToolHandler,
): Promise<{ url: string; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const reply = (status: number, body?: unknown, extra?: Record<string, string>): void => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'mcp-session-id': 'fundet-search',
          ...extra,
        });
        res.end(body === undefined ? undefined : JSON.stringify(body));
      };
      void (async () => {
        try {
          if (req.method === 'DELETE') {
            if (req.headers.authorization !== `Bearer ${token}`) {
              reply(401, { error: 'unauthorized' });
              return;
            }
            res.writeHead(200);
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            reply(405, { error: 'method not allowed' });
            return;
          }
          if (req.headers.authorization !== `Bearer ${token}`) {
            reply(401, { error: 'unauthorized' });
            return;
          }
          const body = await new Promise<string>((ok, fail) => {
            let data = '';
            req.on('data', (chunk: Buffer) => {
              data += chunk.toString('utf8');
              if (data.length > BODY_MAX) {
                fail(new Error('body too large'));
                req.destroy();
              }
            });
            req.on('end', () => ok(data));
            req.on('error', fail);
          });
          const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown };
          if (msg.id === undefined || msg.id === null) {
            reply(202);
            return;
          }
          const out = await dispatch(msg, searchHandler);
          reply(200, out ?? jsonRpcError(msg.id, -32603, 'empty'));
        } catch (err) {
          logger.warn('search mcp 请求失败', { error: String(err) });
          reply(500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('search mcp listen failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/mcp`;
      logger.info('内置搜索 MCP 就绪', { url });
      resolve({
        url,
        dispose: () => {
          server.close();
        },
      });
    });
  });
}
