/**
 * Fundet E2E 驱动脚本（开发验收用，非产品代码）。
 *
 * 前提：`pnpm dev -- --remote-debugging-port=9222` 已启动。
 * 通过 CDP 在真实 renderer 里走 window.fundet（preload → IPC → main → pi）全链路：
 *   建 provider（假 baseUrl 127.0.0.1:9 + 假 key）→ 建会话 → 发消息 → 收集 agent:event，
 * 验证模型不可达时 renderer 收到干净的 error 事件而不是无响应。
 *
 * 用法：node tools/e2e-driver.mjs
 */
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;

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

await cdp('Runtime.enable');

console.log('== 1. window.fundet 可用性');
console.log('  fundet api:', await evalJs(`typeof window.fundet === 'object' ? 'ok' : 'missing'`));

console.log('== 2. 安装事件收集器');
await evalJs(`window.__events = [];
window.__off && window.__off();
window.__off = window.fundet.onAgentEvent((p) => window.__events.push({ sessionId: p.sessionId, type: p.event.type, data: p.event.data }));
'collector installed'`);

console.log('== 3. 创建 provider（假端点 127.0.0.1:9）');
const provider = await evalJs(`window.fundet.createProvider({
  name: 'e2e-fake',
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:9',
  models: [{ id: 'fake-model-1' }],
})`);
console.log('  provider id:', provider.id);
await evalJs(`window.fundet.setProviderKey('${provider.id}', 'sk-fake-e2e-key')`);
console.log('  hasKey:', await evalJs(`window.fundet.hasProviderKey('${provider.id}')`));

console.log('== 4. 创建会话（此时应 spawn pi + RPC 握手）');
const meta = await evalJs(`window.fundet.createSession({
  workDir: '/mnt/d/AI/Fundet',
  providerId: '${provider.id}',
  model: 'fake-model-1',
  title: 'E2E 驱动会话',
})`);
console.log('  session id:', meta.id, 'status: created');

console.log('== 5. 发送消息（模型不可达，期待干净的 error 事件）');
const sendResult = await evalJs(`window.fundet.sendMessage({ sessionId: '${meta.id}', text: '你好，测试一下' })`);
console.log('  send result:', JSON.stringify(sendResult));

console.log('== 6. 轮询事件流（最长 120s，等终态 error/done）');
let terminal = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const events = await evalJs(`window.__events`);
  console.log(`  [${(i + 1) * 3}s] 已收 ${events.length} 个事件: ${events.map((e) => e.type).join(',') || '(无)'}`);
  terminal = events.find((e) => e.type === 'done' || (e.type === 'error' && e.data && e.data.isTerminal));
  if (terminal) break;
}
console.log('  终态事件:', terminal ? JSON.stringify(terminal).slice(0, 800) : '（超时未收到）');

console.log('== 7. 关闭会话（pi 子进程应被回收）');
await evalJs(`window.fundet.closeSession('${meta.id}')`);
await new Promise((r) => setTimeout(r, 3000));

console.log('== 8. 清理 provider');
await evalJs(`window.fundet.deleteProvider('${provider.id}')`);

console.log('DONE');
ws.close();
process.exit(0);
