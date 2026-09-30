/**
 * 内置记忆 MCP：localhost streamable-HTTP，注入 pi cindy-bridge。
 * 模型侧工具名 mcp__fundet-memory__list_tools / call_tool。
 *
 * 渐进式发现（Cindy cindy_memory 同模式）：常驻 prompt 只有两个入口工具
 * （~200 token），细粒度工具（memory_list/read/write/delete/search/consolidate）
 * 经 list_tools 按需发现、call_tool 执行——避免 6 个工具定义常驻撑大小上下文
 * 模型的 system（0.3.11 的 32k 顶死教训）。
 *
 * 协议层不 import agent-core/Electron（node --test 直测，与 search/knowledge 同构）。
 */
import { createServer, type Server } from 'node:http';
import { MEMORY_MCP_CALL_TOOL, MEMORY_MCP_LIST_TOOLS } from '../../shared/memory.ts';

type MemoryMcpLogger = {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
};

export interface MemoryToolOutput {
  text: string;
  isError: boolean;
}

export interface MemoryMcpHandlers {
  listTools: (args: Record<string, unknown>) => Promise<MemoryToolOutput>;
  callTool: (args: Record<string, unknown>) => Promise<MemoryToolOutput>;
}

const BODY_MAX = 1 * 1024 * 1024;

const LIST_TOOLS = {
  name: MEMORY_MCP_LIST_TOOLS,
  description:
    '探索跨会话持久记忆（memory）的可用工具。不传参数 → 返回全部类目与工具简介；' +
    '传 category=read/write/maintain/search → 返回该类目工具的名称、简介与参数。' +
    '拿到工具名后用 call_tool({name, args}) 执行。记忆按工作目录分仓、跨会话共享。',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['read', 'write', 'maintain', 'search'], description: '类目筛选，缺省返回全部' },
    },
  },
};

const CALL_TOOL = {
  name: MEMORY_MCP_CALL_TOOL,
  description:
    '调用 memory 的具体工具（先用 list_tools 拿名称与参数）。业务错误码：' +
    '`MAKER_MEMORY_NOT_READY` = 记忆未启用（提示用户到记忆面板开启）；' +
    '`NOT_FOUND` = 指定记忆文件不存在；`ALREADY_EXISTS` = 新建撞名（改 mode:"update" 或 "append"）；' +
    '`INVALID_PARAMS` = 类型/slug/尺寸等校验失败（按 message 修正后重试）。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'list_tools 返回的工具名，如 memory_search' },
      args: { type: 'object', description: '该工具的参数对象' },
    },
    required: ['name'],
  },
};

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function dispatch(
  msg: { id?: unknown; method?: string; params?: unknown },
  handlers: MemoryMcpHandlers,
): Promise<unknown> {
  const id = msg.id;
  // JSON-RPC notification（无 id）：不应答，上层回 202 静默
  if (id === undefined || id === null) return Promise.resolve(null);
  const method = msg.method ?? '';
  if (method === 'initialize') {
    return Promise.resolve({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fundet-memory', version: '1.0.0' },
      },
    });
  }
  if (method === 'ping') {
    return Promise.resolve({ jsonrpc: '2.0', id, result: {} });
  }
  if (method === 'tools/list') {
    return Promise.resolve({ jsonrpc: '2.0', id, result: { tools: [LIST_TOOLS, CALL_TOOL] } });
  }
  if (method === 'tools/call') {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const handler =
      params.name === MEMORY_MCP_LIST_TOOLS
        ? handlers.listTools
        : params.name === MEMORY_MCP_CALL_TOOL
          ? handlers.callTool
          : null;
    if (!handler) {
      return Promise.resolve(jsonRpcError(id, -32601, `unknown tool: ${params.name ?? ''}`));
    }
    return handler(params.arguments ?? {}).then((out) => ({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: out.text }],
        isError: out.isError,
      },
    }));
  }
  if (id === undefined || id === null) return Promise.resolve(null);
  return Promise.resolve(jsonRpcError(id, -32601, `unknown method: ${method}`));
}

export function startMemoryMcpServer(
  token: string,
  logger: MemoryMcpLogger,
  handlers: MemoryMcpHandlers,
): Promise<{ url: string; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const reply = (status: number, body?: unknown): void => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'mcp-session-id': 'fundet-memory',
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
          logger.warn('memory mcp 请求失败', { error: String(err) });
          reply(500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('memory mcp listen failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/mcp`;
      logger.info('内置记忆 MCP 就绪', { url });
      resolve({
        url,
        dispose: () => {
          server.close();
        },
      });
    });
  });
}
