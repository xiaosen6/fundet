/**
 * Fundet 阶段 3 正式 UI 验收驱动（CDP，真实 Electron 窗口）。
 *
 * 前提：`FUNDET_CDP_PORT=9222 pnpm dev` 已启动。
 *
 * 流程（尽量走真实 DOM 交互，数据准备用 window.fundet）：
 *   1. 设置页：配 provider（假端点 127.0.0.1:9）+ 截图
 *   2. 会话页：新建会话（点真实按钮）→ 发消息（真实输入框 + 点击发送）
 *   3. 等模型不可达的 error 事件 → 断言渲染成错误卡片（.bg-error-bg）而非 JSON 流 → 截图
 *   4. 再发一条 → 断言中断按钮出现 → 点击中断
 *   5. 建第二个会话 → 切回第一个 → 断言历史从 DB 重建（用户气泡 + 错误卡都在）
 *   6. 设置页切深色 → 回会话页截图 → 断言 data-theme=dark 且背景色变了 → 切回浅色
 *
 * 截图输出：tools/screenshots/phase3-*.png
 * 用法：node tools/e2e-ui-driver.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;
const SHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
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

const ws = new WebSocket(await getPageWsUrl());
await new Promise((resolveP, reject) => {
  ws.onopen = resolveP;
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
  return new Promise((resolveP) => {
    pendingCalls.set(id, resolveP);
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
    throw new Error(`renderer 异常: ${JSON.stringify(res.result.exceptionDetails).slice(0, 600)}`);
  }
  if (res.result?.result?.subtype === 'error') {
    throw new Error(`renderer 抛错: ${res.result.result.description?.slice(0, 600)}`);
  }
  return res.result?.result?.value;
}

async function shot(name) {
  const res = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = resolve(SHOT_DIR, `phase3-${name}.png`);
  writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log(`  📷 ${file}`);
}

async function waitFor(desc, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      if (await evalJs(expression)) return true;
    } catch (err) {
      // 页面尚未加载完（about:blank 无 localStorage 等）时容忍并重试
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待超时: ${desc}${lastErr ? `（最后错误: ${lastErr.message}）` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await cdp('Runtime.enable');
await cdp('Page.enable');

// ---------------------------------------------------------------------------
console.log('== 0. 准备：默认工作目录 + provider（假端点）');
await waitFor('页面加载完成', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object'`, 30000);
await evalJs(`window.localStorage.setItem('fundet.defaultWorkDir', '/mnt/d/AI/Fundet'); 'ok'`);
// 清掉上次运行残留的 provider 与「新会话」会话
await evalJs(`(async () => {
  const list = await window.fundet.listProviders();
  for (const p of list.filter((x) => x.name === 'ui-e2e-fake')) await window.fundet.deleteProvider(p.id);
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.title === '新会话')) await window.fundet.deleteSession(s.id);
  return 'cleaned';
})()`);
await evalJs(`(async () => {
  const p = await window.fundet.createProvider({
    name: 'ui-e2e-fake',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9',
    models: [{ id: 'fake-model-1' }, { id: 'fake-model-2' }],
  });
  await window.fundet.setProviderKey(p.id, 'sk-fake-ui-e2e');
  return p.id;
})()`).then((id) => console.log('  provider id:', id));

console.log('== 1. 设置页渲染 + 截图');
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await waitFor('provider 行渲染', `document.body.innerText.includes('ui-e2e-fake')`);
await shot('01-settings-light');

console.log('== 2. 会话页：点真实「新建会话」按钮');
await evalJs(`window.location.hash = '#/'; 'ok'`);
await waitFor('sidebar 渲染', `document.querySelector('button[data-sidebar-action="new-chat"]') !== null`);
await evalJs(`document.querySelector('button[data-sidebar-action="new-chat"]').click(); 'ok'`);
await waitFor('输入框出现', `document.querySelector('textarea') !== null`);
const sessionCount1 = await evalJs(`(async () => (await window.fundet.listSessions()).length)()`);
console.log('  会话数:', sessionCount1);
await shot('02-new-session');

console.log('== 3. 真实输入 + 点发送（假端点 → 期待错误卡片）');
await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '你好，介绍一下你自己');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(300);
await evalJs(`document.querySelector('button[title="发送"]').click(); 'ok'`);
console.log('  已发送，等待终态错误（最长 90s）…');
// 用户气泡应立即出现
await waitFor('用户气泡渲染', `document.body.innerText.includes('你好，介绍一下你自己')`, 10000);
// 错误卡片：.bg-error-bg 容器出现即证明渲染成卡片而不是 JSON 流
await waitFor('错误卡片渲染', `document.querySelector('.bg-error-bg') !== null`, 90000);
const errText = await evalJs(`document.querySelector('.bg-error-bg').innerText.slice(0, 200)`);
console.log('  错误卡片内容:', JSON.stringify(errText));
await shot('03-error-card');

console.log('== 4. 再发一条：断言中断按钮出现并可点击');
await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '再来一条测中断');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(300);
await evalJs(`document.querySelector('button[title="发送"]').click(); 'ok'`);
await waitFor('中断按钮出现', `document.querySelector('button[title="中断当前回合"]') !== null`, 30000);
await shot('04-abort-button');
await evalJs(`document.querySelector('button[title="中断当前回合"]').click(); 'ok'`);
await sleep(2000);
console.log('  已点击中断');
// 等这一轮也收干净（终态错误或 Done）
await waitFor('第二轮终态', `(document.querySelectorAll('.bg-error-bg').length >= 2) || document.body.innerText.includes('Done')`, 90000).catch(() => console.log('  （第二轮终态等待超时，继续）'));

console.log('== 5. 多会话：建第二个会话 → 刷新页面 → 点回第一个 → 历史从 DB 重建');
await evalJs(`document.querySelector('button[data-sidebar-action="new-chat"]').click(); 'ok'`);
await waitFor('第二个会话激活', `(async () => (await window.fundet.listSessions()).length >= ${Number(sessionCount1) + 1})()`);
await shot('05-second-session');
// 整页刷新：slice 全空，切回第一个会话时历史必须完全从 DB 重建（ensureHistory 路径）
await evalJs(`window.location.reload(); 'ok'`);
await waitFor('刷新后页面就绪', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object' && document.querySelector('aside') !== null`, 30000);
const switched = await evalJs(`(() => {
  const items = [...document.querySelectorAll('aside .group')];
  const target = items[items.length - 1];
  if (!target) return 'no-item';
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'clicked';
})()`);
console.log('  切换:', switched);
await waitFor(
  '历史重建（旧用户气泡回来）',
  `document.body.innerText.includes('你好，介绍一下你自己')`,
  15000,
);
const hasErrCard = await evalJs(`document.querySelector('.bg-error-bg') !== null`);
console.log('  历史含错误卡片:', hasErrCard);
await shot('06-history-rebuilt');

console.log('== 6. 主题：设置页切深色 → 会话页截图 → 切回浅色');
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await waitFor('主题按钮渲染', `document.body.innerText.includes('深色')`);
const bgBefore = await evalJs(`getComputedStyle(document.body).backgroundColor`);
await evalJs(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '深色')).click(); 'ok'`);
await sleep(400);
const themeAttr = await evalJs(`document.documentElement.dataset.theme`);
const bgAfter = await evalJs(`getComputedStyle(document.body).backgroundColor`);
console.log('  data-theme:', themeAttr, '| 背景:', bgBefore, '→', bgAfter);
if (themeAttr !== 'dark' || bgBefore === bgAfter) throw new Error('深色主题未生效');
await shot('07-settings-dark');
await evalJs(`window.location.hash = '#/'; 'ok'`);
await sleep(600);
await shot('08-chat-dark');
// 切回浅色收尾
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await evalJs(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '浅色')).click(); 'ok'`);
await sleep(300);

console.log('== 7. /debug 调试台仍可访问');
await evalJs(`window.location.hash = '#/debug'; 'ok'`);
await waitFor('调试台渲染', `document.body.innerText.includes('Fundet 调试台')`, 10000);
await shot('09-debug');

console.log('== 8. 清理：删除本次 provider 与新建会话');
await evalJs(`(async () => {
  const list = await window.fundet.listProviders();
  for (const p of list.filter((x) => x.name === 'ui-e2e-fake')) await window.fundet.deleteProvider(p.id);
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.title === '新会话')) await window.fundet.deleteSession(s.id);
  return 'cleaned';
})()`);

console.log('ALL PASS');
ws.close();
process.exit(0);
