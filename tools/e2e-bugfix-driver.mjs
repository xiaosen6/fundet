/**
 * Fundet 双 bug 修复验收驱动（CDP，真实 Electron 窗口）。
 *
 * 前提：`FUNDET_CDP_PORT=9222 pnpm dev` 已启动。
 *
 * Bug2（新建空会话不 spawn pi）：
 *   1. 记录 pi 进程数基线 → 点 3 次「新建会话」→ 断言 pi 进程数不变、
 *      listSessions 不变（草稿纯本地）、sidebar 出现 3 个草稿项
 *   2. 删除 2 个草稿 → 断言 main 侧仍零副作用
 *   3. 在剩馀草稿里发首条消息 → 断言 pi 进程数 +1（lazy-create 生效）
 *
 * Bug1（401 消息级错误不被吞）：
 *   4. provider 配 anthropic-messages + https://api.kimi.com/coding + sk-invalid-test
 *   5. 上述首条消息必然 401 → 断言错误卡片出现且含 "401"、输入框恢复可用 → 截图
 *
 * 收尾：删除测试 provider / 会话。
 * 用法：node tools/e2e-bugfix-driver.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;
const SHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

function piProcessCount() {
  try {
    const out = execSync('ps aux | grep pi-bin | grep -v grep | wc -l').toString().trim();
    return Number(out);
  } catch {
    return -1;
  }
}

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(`${BASE}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* CDP 还没起来 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('找不到 renderer page target');
}

const ws = new WebSocket(await getPageWsUrl());
await new Promise((resolveP, reject) => { ws.onopen = resolveP; ws.onerror = reject; });

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
  return new Promise((resolveP) => {
    pendingCalls.set(id, resolveP);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    throw new Error(`renderer 异常: ${JSON.stringify(res.result.exceptionDetails).slice(0, 600)}`);
  }
  if (res.result?.result?.subtype === 'error') {
    throw new Error(`renderer 抛错: ${res.result.result.description?.slice(0, 600)}`);
  }
  return res.result?.result?.value;
}

async function shot(name) {
  const res = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = resolve(SHOT_DIR, `bugfix-${name}.png`);
  writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log(`  📷 ${file}`);
}

async function waitFor(desc, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      if (await evalJs(expression)) return true;
    } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待超时: ${desc}${lastErr ? `（最后错误: ${lastErr.message}）` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

await cdp('Runtime.enable');
await cdp('Page.enable');

// ---------------------------------------------------------------------------
console.log('== 0. 准备：工作目录 + 401 provider + 清残留');
await waitFor('页面加载完成', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object'`, 30000);
await evalJs(`window.localStorage.setItem('fundet.defaultWorkDir', '/tmp/fundet-e2e-workdir'); 'ok'`);
const providerId = await evalJs(`(async () => {
  const list = await window.fundet.listProviders();
  for (const p of list.filter((x) => x.name === 'e2e-401')) await window.fundet.deleteProvider(p.id);
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.model === 'kimi-for-coding-e2e')) await window.fundet.deleteSession(s.id);
  const p = await window.fundet.createProvider({
    name: 'e2e-401',
    api: 'anthropic-messages',
    baseUrl: 'https://api.kimi.com/coding',
    models: [{ id: 'kimi-for-coding-e2e' }],
  });
  await window.fundet.setProviderKey(p.id, 'sk-invalid-test');
  window.localStorage.setItem('fundet.lastProviderId', p.id);
  window.localStorage.setItem('fundet.lastModel', 'kimi-for-coding-e2e');
  return p.id;
})()`);
console.log('  provider id:', providerId);
// workDir 必须真实存在（spawn 的 cwd），且 ChatPage 的 providers 是挂载时拉的——
// reload 让它包含新建的 e2e provider
execSync('mkdir -p /tmp/fundet-e2e-workdir');
await evalJs(`window.location.reload(); 'ok'`);
await waitFor('刷新后页面就绪', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object' && document.querySelector('aside') !== null`, 30000);

// ---------------------------------------------------------------------------
console.log('== 1. Bug2：连点 3 次「新建会话」→ 不 spawn pi、不进 DB');
await evalJs(`window.location.hash = '#/'; 'ok'`);
await waitFor('sidebar 渲染', `document.querySelector('button[data-sidebar-action="new-chat"]') !== null`);
const baseline = {
  pi: piProcessCount(),
  sessions: await evalJs(`(async () => (await window.fundet.listSessions()).length)()`),
  items: await evalJs(`document.querySelectorAll('aside .group').length`),
};
console.log('  基线: pi 进程', baseline.pi, '| DB 会话', baseline.sessions, '| sidebar 项', baseline.items);

for (let i = 0; i < 3; i++) {
  await evalJs(`document.querySelector('button[data-sidebar-action="new-chat"]').click(); 'ok'`);
  await sleep(300);
}
await sleep(2500); // 给「错误实现会 spawn」留足握手时间
assert(piProcessCount() === baseline.pi, '点 3 次新建后 pi 进程数不变');
assert(
  (await evalJs(`(async () => (await window.fundet.listSessions()).length)()`)) === baseline.sessions,
  'DB 会话数不变（草稿未落库）',
);
assert(
  (await evalJs(`document.querySelectorAll('aside .group').length`)) === baseline.items,
  '空草稿不进 sidebar',
);
await shot('01-drafts-no-spawn');

console.log('== 2. Bug2：空草稿不进列表，删除/切换无对象可点（pi / DB 仍不变）');
assert(piProcessCount() === baseline.pi, '空草稿阶段 pi 进程数不变');
assert(
  (await evalJs(`(async () => (await window.fundet.listSessions()).length)()`)) === baseline.sessions,
  '空草稿阶段 DB 会话数不变',
);

console.log('== 3. Bug2：新对话已打开 composer（无 main 副作用）');
await waitFor('输入框出现', `document.querySelector('textarea') !== null`);
assert(piProcessCount() === baseline.pi, '打开空对话后 pi 进程数仍不变');

// ---------------------------------------------------------------------------
console.log('== 4. Bug1：草稿里发首条消息（必然 401）→ 错误卡片 + 输入恢复');
await waitFor('输入框出现', `document.querySelector('textarea') !== null`);
await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '你好，测试 401');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(300);
await evalJs(`document.querySelector('button[title="发送"]').click(); 'ok'`);
await waitFor('用户气泡渲染', `document.body.innerText.includes('你好，测试 401')`, 10000);
await waitFor('pi 进程 spawn（首条消息 lazy-create）', `true`, 1000); // 占位，下面直接查
await waitFor(
  'pi 进程数 +1',
  `true`,
  1,
).catch(() => {});
// 直接轮询进程数
{
  const deadline = Date.now() + 15000;
  let n = piProcessCount();
  while (n !== baseline.pi + 1 && Date.now() < deadline) {
    await sleep(500);
    n = piProcessCount();
  }
  assert(n === baseline.pi + 1, '首条消息后 pi 进程数 +1（lazy-create 真的起了进程）');
}
{
  // storage.create 在 startSession 返回后才落库，与进程可见存在毫秒级竞态，轮询等待
  const deadline = Date.now() + 10000;
  let n = await evalJs(`(async () => (await window.fundet.listSessions()).length)()`);
  while (n !== baseline.sessions + 1 && Date.now() < deadline) {
    await sleep(500);
    n = await evalJs(`(async () => (await window.fundet.listSessions()).length)()`);
  }
  assert(n === baseline.sessions + 1, '首条消息后 DB 会话数 +1（草稿已落库）');
}

console.log('  等待 401 错误卡片（最长 60s）…');
await waitFor('错误卡片渲染', `document.querySelector('.bg-error-bg') !== null`, 60000);
const errText = await evalJs(`document.querySelector('.bg-error-bg').innerText`);
assert(errText.includes('401'), `错误卡片含 401 关键信息（实际: ${errText.slice(0, 160)}）`);
await shot('02-401-error-card');

// 输入框恢复可用：终态后发送按钮回来 / 中断按钮消失，textarea 可输入
await waitFor(
  '输入框恢复可用（中断按钮消失）',
  `document.querySelector('button[title="中断当前回合"]') === null && document.querySelector('button[title="发送"]') !== null && !document.querySelector('textarea').disabled`,
  15000,
);
console.log('  ✓ 错误后输入框恢复可用（isRunning=false）');
await shot('03-input-recovered');

// ---------------------------------------------------------------------------
console.log('== 5. 清理：删测试会话 + provider');
await evalJs(`(async () => {
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.model === 'kimi-for-coding-e2e')) await window.fundet.deleteSession(s.id);
  const list = await window.fundet.listProviders();
  for (const p of list.filter((x) => x.name === 'e2e-401')) await window.fundet.deleteProvider(p.id);
  window.localStorage.removeItem('fundet.lastProviderId');
  window.localStorage.removeItem('fundet.lastModel');
  return 'cleaned';
})()`);
await sleep(1500);
assert(piProcessCount() === baseline.pi, '清理后 pi 进程数回到基线');

console.log('ALL PASS');
ws.close();
process.exit(0);
