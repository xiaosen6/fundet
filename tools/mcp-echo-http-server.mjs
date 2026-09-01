/**
 * 最小 streamable-HTTP MCP echo server（阶段 4 验证用，非产品代码）。
 * 监听 127.0.0.1:8877，POST application/json 单条 JSON-RPC，响应 application/json。
 * 要求 Authorization: Bearer stage4-token（验证 bridge 的 remote.headerEnvVars 通路）。
 * 工具：echo_http（原样返回 text 参数）。
 */
import { createServer } from 'node:http';

const TOKEN = 'stage4-token';
const PORT = 8877;

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    // notification：202 空体语义，这里回 200 + null 也能过（bridge notify 接受任意响应）
    if (msg.id === undefined || msg.id === null) {
      res.end(JSON.stringify(null));
      return;
    }
    switch (msg.method) {
      case 'initialize':
        res.end(JSON.stringify(rpcResult(msg.id, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fundet-echo-http', version: '1.0.0' },
        })));
        break;
      case 'tools/list':
        res.end(JSON.stringify(rpcResult(msg.id, {
          tools: [
            {
              name: 'echo_http',
              description: 'Echo back the text argument (http)',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        })));
        break;
      case 'tools/call':
        res.end(JSON.stringify(rpcResult(msg.id, {
          content: [{ type: 'text', text: `echo_http: ${msg.params?.arguments?.text ?? ''}` }],
        })));
        break;
      default:
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        }));
    }
  });
}).listen(PORT, '127.0.0.1', () => {
  console.error(`[echo-http] listening on 127.0.0.1:${PORT}`);
});
