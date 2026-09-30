/**
 * 内置生图 MCP：localhost streamable-HTTP，注入 pi cindy-bridge。
 * 模型侧工具名 mcp__fundet-imagegen__generate_image。
 *
 * 单工具直接暴露（不用 memory 的渐进式发现——只有一个工具，描述 ~100 token）。
 * 协议层不 import Electron/agent-core（node --test 直测）。
 */
import { createServer, type Server } from 'node:http';
import { IMAGEGEN_TOOL_NAME } from '../../shared/imagegen.ts';
import type { ImagegenToolOutput } from './handlers.ts';

type ImagegenMcpLogger = {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
};

const BODY_MAX = 1 * 1024 * 1024;

const TOOL = {
  name: IMAGEGEN_TOOL_NAME,
  description:
    '生成一张图片并保存到当前工作目录（PNG，约 30 秒）。用户说"画一个/生成一张/来一张图/设计一个形象"等时用本工具。' +
    'prompt 用具体完整的画面描述（主体+风格+构图+背景），中文英文都可以。' +
    '本工具确实存在：调用失败（超时/HTTP 错误）多为生图服务繁忙——应向用户说明繁忙并建议稍后重试或减小尺寸，' +
    '不要因此声称自己没有生图能力。',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '画面描述：主体、风格、构图、背景，越具体越好' },
      size: { type: 'string', description: '宽x高，默认 1024x1024；横图如 1280x720，边长 256..3072' },
    },
    required: ['prompt'],
  },
};

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function dispatch(
  msg: { id?: unknown; method?: string; params?: unknown },
  handlers: { generateImage: (args: Record<string, unknown>) => Promise<ImagegenToolOutput> },
): Promise<unknown> {
  const id = msg.id;
  if (id === undefined || id === null) return Promise.resolve(null);
  const method = msg.method ?? '';
  if (method === 'initialize') {
    return Promise.resolve({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fundet-imagegen', version: '1.0.0' },
      },
    });
  }
  if (method === 'ping') {
    return Promise.resolve({ jsonrpc: '2.0', id, result: {} });
  }
  if (method === 'tools/list') {
    return Promise.resolve({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  }
  if (method === 'tools/call') {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== IMAGEGEN_TOOL_NAME) {
      return Promise.resolve(jsonRpcError(id, -32601, `unknown tool: ${params.name ?? ''}`));
    }
    return handlers.generateImage(params.arguments ?? {}).then((out) => ({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: out.text }],
        isError: out.isError,
      },
    }));
  }
  return Promise.resolve(jsonRpcError(id, -32601, `unknown method: ${method}`));
}

export function startImagegenMcpServer(
  token: string,
  logger: ImagegenMcpLogger,
  handlers: { generateImage: (args: Record<string, unknown>) => Promise<ImagegenToolOutput> },
): Promise<{ url: string; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const reply = (status: number, body?: unknown): void => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'mcp-session-id': 'fundet-imagegen',
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
          const out = await dispatch(msg, handlers);
          reply(200, out ?? jsonRpcError(msg.id, -32603, 'empty'));
        } catch (err) {
          logger.warn('imagegen mcp 请求失败', { error: String(err) });
          reply(500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('imagegen mcp listen failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/mcp`;
      logger.info('内置生图 MCP 就绪', { url });
      resolve({
        url,
        dispose: () => {
          server.close();
        },
      });
    });
  });
}
