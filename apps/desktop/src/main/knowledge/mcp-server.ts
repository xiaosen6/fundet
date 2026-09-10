/**
 * 内置知识库 MCP：localhost streamable-HTTP，注入 pi cindy-bridge。
 * 工具名 knowledge_search → 模型侧 mcp__knowledge__knowledge_search。
 *
 * 与 search/mcp-server.ts 同构（协议层不 import 密钥/Electron/db，便于 node --test）。
 */
import { createServer, type Server } from 'node:http';
import { brand } from '../../shared/brand.ts';
import { KNOWLEDGE_MCP_TOOL_NAME } from '../../shared/knowledge.ts';

type KnowledgeMcpLogger = {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
};

export interface KnowledgeToolOutput {
  text: string;
  isError: boolean;
}

export type KnowledgeToolHandler = (args: Record<string, unknown>) => Promise<KnowledgeToolOutput>;

const BODY_MAX = 1 * 1024 * 1024;

const TOOL = {
  name: KNOWLEDGE_MCP_TOOL_NAME,
  description:
    `检索用户绑定的本地知识库（用户自己的文档：制度/手册/笔记等），返回带来源编号的原文片段。` +
    `涉及用户资料里的具体事实、条款、数据时必须先调用本工具，不要凭记忆回答。` +
    `query 用与答案最相关的关键词（可多次调用换不同关键词）。`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索词，用文档里可能出现的原词，不要扩写' },
      limit: { type: 'number', description: '条数，默认 6，最大 20' },
    },
    required: ['query'],
  },
};

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function dispatch(
  msg: { id?: unknown; method?: string; params?: unknown },
  handler: KnowledgeToolHandler,
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
        serverInfo: { name: 'fundet-knowledge', version: '1.0.0' },
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
    if (params.name !== KNOWLEDGE_MCP_TOOL_NAME) {
      return jsonRpcError(id, -32601, `unknown tool: ${params.name ?? ''}`);
    }
    const out = await handler(params.arguments ?? {});
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

export function startKnowledgeMcpServer(
  token: string,
  logger: KnowledgeMcpLogger,
  handler: KnowledgeToolHandler,
): Promise<{ url: string; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const reply = (status: number, body?: unknown): void => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'mcp-session-id': 'fundet-knowledge',
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
          const out = await dispatch(msg, handler);
          reply(200, out ?? jsonRpcError(msg.id, -32603, 'empty'));
        } catch (err) {
          logger.warn('knowledge mcp 请求失败', { error: String(err) });
          reply(500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('knowledge mcp listen failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/mcp`;
      logger.info('内置知识库 MCP 就绪', { url });
      resolve({
        url,
        dispose: () => {
          server.close();
        },
      });
    });
  });
}
