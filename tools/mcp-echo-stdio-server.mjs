/**
 * 最小 stdio MCP echo server（阶段 4 验证用，非产品代码）。
 * 协议：NDJSON（每行一个 JSON-RPC 消息），实现 initialize / tools/list / tools/call。
 * 工具：echo（原样返回 text 参数）。
 */
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // notification（无 id）不回应
  if (msg.id === undefined || msg.id === null) return;

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fundet-echo-stdio', version: '1.0.0' },
        },
      });
      break;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo back the text argument',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        },
      });
      break;
    case 'tools/call':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text ?? ''}` }],
        },
      });
      break;
    default:
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
  }
});
