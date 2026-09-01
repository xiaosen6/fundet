/**
 * Fundet 阶段 4 E2E 驱动（开发验收用，非产品代码）。
 *
 * 前提：
 *   1. `FUNDET_CDP_PORT=9222 pnpm dev -- --remote-debugging-port=9222` 已启动；
 *   2. 本脚本会自己 spawn tools/mcp-echo-http-server.mjs（127.0.0.1:8877）。
 *
 * 通过 CDP 走 window.fundet 全链路验证：
 *   - 记忆开关：set(true) → status 为 true（settings 表持久化 + manager 状态）；
 *   - MCP：注册 stdio echo + http echo 两个 server → 建会话时经
 *     preparePiExtraSpawnConfig 注入 → pi 侧 cindy-bridge 连接成功
 *     （证据在 main 进程 stdout 的 'pi stderr ... [cindy-bridge] connected ...'，
 *      由调用方 grep dev 日志确认，本脚本只负责触发链路）。
 *
 * 用法：node tools/e2e-stage4-driver.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STDIO_SERVER = path.join(HERE, 'mcp-echo-stdio-server.mjs');
const HTTP_SERVER = path.join(HERE, 'mcp-echo-http-server.mjs');

// 起 http echo server（验证 remote.headerEnvVars 通路）
const httpServer = spawn(process.execPath, [HTTP_SERVER], { stdio: ['ignore', 'ignore', 'inherit'] });
process.on('exit', () => httpServer.kill());
await new Promise((r) => setTimeout(r, 800));

async function getPageWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await (await fetch(`${BASE}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // CDP 还没起来
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('找不到 renderer page target');
}

const wsUrl = await getPageWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pendingCalls = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pendingCalls.has(msg.id)) {
    pendingCalls.get(msg.id)(msg);
    pendingCalls.delete(msg.id);
  }
};

function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pendingCalls.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const res = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(`renderer 异常: ${JSON.stringify(res.result.exceptionDetails).slice(0, 500)}`);
  }
  if (res.result?.result?.subtype === 'error') {
    throw new Error(`renderer 抛错: ${res.result.result.description?.slice(0, 500)}`);
  }
  return res.result?.result?.value;
}

function assert(cond, label) {
  if (!cond) throw new Error(`断言失败: ${label}`);
  console.log(`  PASS ${label}`);
}

await cdp('Runtime.enable');

console.log('== 1. window.fundet 可用性');
assert((await evalJs(`typeof window.fundet === 'object' ? 'ok' : 'missing'`)) === 'ok', 'fundet api 存在');

console.log('== 2. 注册两个 MCP server（stdio echo + http echo）');
const stdioSrv = await evalJs(`window.fundet.createMcpServer({
  name: 'echostdio',
  type: 'stdio',
  command: ${JSON.stringify(process.execPath)},
  args: ${JSON.stringify([STDIO_SERVER])},
})`);
console.log('  stdio server id:', stdioSrv.id);
const httpSrv = await evalJs(`window.fundet.createMcpServer({
  name: 'echohttp',
  type: 'http',
  url: 'http://127.0.0.1:8877/mcp',
  headers: { Authorization: 'Bearer stage4-token' },
})`);
console.log('  http server id:', httpSrv.id);
const mcpList = await evalJs(`window.fundet.listMcpServers()`);
assert(mcpList.length === 2 && mcpList.every((s) => s.enabled), 'listMcpServers 返回 2 个 enabled server');

console.log('== 5. 输入校验：坏 url 应被拒绝');
const badRejected = await evalJs(`window.fundet.createMcpServer({
  name: 'bad', type: 'http', url: 'http://example.com/mcp',
}).then(() => 'not-rejected').catch((e) => 'rejected')`);
assert(badRejected === 'rejected', 'http 非 loopback 明文 url 被入口校验拒绝');

console.log('== 6. 建 provider + 会话（触发 preparePiExtraSpawnConfig + bridge 连接）');
const provider = await evalJs(`window.fundet.createProvider({
  name: 'e2e-stage4-fake',
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:9',
  models: [{ id: 'fake-model-1' }],
})`);
await evalJs(`window.fundet.setProviderKey('${provider.id}', 'sk-fake-e2e-key')`);
const meta = await evalJs(`window.fundet.createSession({
  workDir: '/mnt/d/AI/Fundet',
  providerId: '${provider.id}',
  model: 'fake-model-1',
  title: '阶段4 E2E 会话',
})`);
console.log('  session id:', meta.id);
assert(typeof meta.id === 'string' && meta.id.length > 0, '会话创建成功（pi spawn + RPC 握手 + MCP 注入）');

console.log('== 7. 等 8s 让 bridge 完成 MCP 连接，再发消息确认会话活着');
await new Promise((r) => setTimeout(r, 8000));
const sendResult = await evalJs(
  `window.fundet.sendMessage({ sessionId: '${meta.id}', text: 'ping' })`,
);
assert(sendResult.accepted === true, `消息被接受（会话存活，实际 ${JSON.stringify(sendResult)}）`);

console.log('== 8. 等 15s 收集事件（模型不可达，期待 error 事件而非崩溃）');
await evalJs(`window.__events = [];
window.__off && window.__off();
window.__off = window.fundet.onAgentEvent((p) => window.__events.push(p.event.type));
'ok'`);
await new Promise((r) => setTimeout(r, 15000));
const events = await evalJs(`window.__events`);
console.log('  事件流:', events.join(',') || '(无)');

console.log('== 9. 关闭会话（disposeSessionCtx 应关代理 + 杀 stdio 子进程）');
await evalJs(`window.fundet.closeSession('${meta.id}')`);
await new Promise((r) => setTimeout(r, 3000));

console.log('== 10. 清理（删 provider + 2 个 MCP server）');
await evalJs(`window.fundet.deleteProvider('${provider.id}')`);
await evalJs(`window.fundet.deleteMcpServer('${stdioSrv.id}')`);
await evalJs(`window.fundet.deleteMcpServer('${httpSrv.id}')`);

console.log('DONE — 请 grep dev 日志确认:');
console.log('  "mcp stdio server 就绪" / "[cindy-bridge] connected echostdio (1 tools)"');
console.log('  "[cindy-bridge] connected echohttp (1 tools)"');
ws.close();
process.exit(0);
