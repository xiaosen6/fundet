/**
 * 浏览器 MCP 的 streamable-HTTP 挂载：把 in-process SDK McpServer 暴露到
 * 127.0.0.1 随机端口 + Bearer token，供 pi 的 cindy-bridge 连接。
 *
 * 挂载模式照搬 Cindy codexHttpBridge 的核心（StreamableHTTPServerTransport +
 * transport.handleRequest），砍掉 codex 会话上下文传导。每个 pi 会话一份
 * server + http 实例（与搜索 MCP 同生命周期），底层共享同一个 runtime 单例。
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createBrowserMcpServer } from '@fundet/browser-mcp';
import type { BrowserControlRuntime } from '@fundet/browser-runtime';
import type { Logger } from '@fundet/agent-core';

const BODY_MAX = 32 * 1024 * 1024;

type FacadeLogger = {
  trace(msg: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  fatal(msg: string): void;
};

export async function startBrowserMcpServer(
  token: string,
  logger: Logger,
  runtime: BrowserControlRuntime,
): Promise<{ url: string; dispose: () => void }> {
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const facadeLogger: FacadeLogger = {
    trace: (msg: string) => logger.debug(msg),
    debug: (msg: string) => logger.debug(msg),
    info: (msg: string) => logger.info(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    fatal: (msg: string) => logger.error(msg),
  };
  const server = createBrowserMcpServer({
    getRuntime: () => runtime,
    logger: facadeLogger,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    void (async () => {
      try {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        if (req.method === 'DELETE') {
          res.writeHead(200);
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const body = await new Promise<string>((resolve, reject) => {
          let data = '';
          req.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf-8');
            if (data.length > BODY_MAX) {
              reject(new Error('body too large'));
              req.destroy();
            }
          });
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        const parsed = body ? (JSON.parse(body) as unknown) : undefined;
        await transport.handleRequest(req, res, parsed);
      } catch (err) {
        logger.warn('browser mcp 请求失败', { error: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    httpServer.close();
    throw new Error('browser mcp listen failed');
  }
  const url = `http://127.0.0.1:${address.port}/mcp`;
  logger.info('浏览器 MCP 就绪', { url });

  return {
    url,
    dispose: () => {
      void server.close().catch(() => undefined);
      httpServer.close();
    },
  };
}
