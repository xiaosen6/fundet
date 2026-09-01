/**
 * Fundet UI 像素级校准驱动（对照 tools/ref-shots/cindy-*.png 真机参照）。
 *
 * 前提：`FUNDET_CDP_PORT=9222 pnpm dev` 已启动。
 *
 * 覆盖（与参照图一一对应）：
 *   01 空态·无 provider → 内联「连接模型提供商」引导面板（对 cindy-02 的 Connect 面板）
 *   02 设置·通用 tab（对 cindy-05）
 *   03 设置·Providers tab（对 cindy-06）
 *   04 空态·有 provider（品牌 wordmark + 引导卡）
 *   05 新建会话 composer（对 cindy-02 的 composer 解剖）
 *   06 权限选择器面板（对 cindy-04）
 *   07 权限选中 auto（蓝色档文字）
 *   08 模型选择器面板（对 cindy-03）
 *   09 运行状态行；10 错误卡片
 *   11 深色会话页（对 cindy-08）；12 深色设置（对 cindy-07）
 *
 * 截图输出：tools/screenshots/ui-calib-*.png
 * 用法：node tools/e2e-ui-calib-driver.mjs
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
      const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:517'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // CDP 还没起来
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('找不到 renderer page target');
}

const ws = new WebSocket(await getPageWsUrl());
await new Promise((resolveP, rejectP) => {
  ws.onopen = resolveP;
  ws.onerror = rejectP;
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
  const file = resolve(SHOT_DIR, `ui-calib-${name}.png`);
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
console.log('== 0. 准备：清残留 provider/会话，浅色起步');
await waitFor('页面加载完成', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object'`, 30000);
await evalJs(`window.localStorage.setItem('fundet.defaultWorkDir', '/mnt/d/AI/Fundet'); 'ok'`);
await evalJs(`window.localStorage.setItem('fundet.theme', 'light'); 'ok'`);
await evalJs(`(async () => {
  const list = await window.fundet.listProviders();
  for (const p of list) await window.fundet.deleteProvider(p.id);
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.title === '新会话')) await window.fundet.deleteSession(s.id);
  return 'cleaned';
})()`);
await evalJs(`window.location.hash = '#/'; window.location.reload(); 'ok'`);
await waitFor('重载就绪', `location.origin.startsWith('http') && document.readyState === 'complete' && typeof window.fundet === 'object' && document.querySelector('aside') !== null`, 30000);

console.log('== 1. 空态·无 provider → Connect 引导面板');
await waitFor('引导面板渲染', `document.body.innerText.includes('连接模型提供商以开始')`);
await shot('01-empty-connect-panel');

console.log('== 2. 设置页：通用 + Providers（空列表）');
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await waitFor('设置页渲染', `document.body.innerText.includes('默认工作目录')`);
await shot('02-settings-general');
await evalJs(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Providers')).click(); 'ok'`);
await sleep(400);
await shot('03-settings-providers-empty');

console.log('== 3. 建假 provider → 回空态（有 provider 版）');
await evalJs(`(async () => {
  const p = await window.fundet.createProvider({
    name: 'ui-calib-fake',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9',
    models: [{ id: 'fake-model-1' }, { id: 'fake-model-2' }],
  });
  await window.fundet.setProviderKey(p.id, 'sk-fake-ui-calib');
  return p.id;
})()`).then((id) => console.log('  provider id:', id));
// 绕过 UI 直连 IPC 不触发 React 刷新 —— 切走再切回强制 SettingsPage 重挂载拉列表
await evalJs(`window.location.hash = '#/'; 'ok'`);
await sleep(300);
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await waitFor('设置页重挂载', `document.body.innerText.includes('默认工作目录')`);
await evalJs(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Providers')).click(); 'ok'`);
// Providers tab 已有行 → 截一张带行的
await waitFor('provider 行渲染', `document.body.innerText.includes('ui-calib-fake')`);
await shot('04-settings-providers');
await evalJs(`window.location.hash = '#/'; 'ok'`);
await waitFor('空态引导卡', `document.body.innerText.includes('选择左侧会话')`);
await shot('05-empty-state');

console.log('== 4. 新建会话 → composer 解剖');
await evalJs(`document.querySelector('button[data-sidebar-action="new-chat"]').click(); 'ok'`);
await waitFor('输入框出现', `document.querySelector('textarea') !== null`);
await sleep(400);
await shot('06-composer');

console.log('== 5. 权限选择器面板 + auto 蓝色档');
await evalJs(`([...document.querySelectorAll('button')].find((b) => b.innerText.includes('每次询问'))).click(); 'ok'`);
await sleep(500);
await shot('07-permission-panel');
await evalJs(`([...document.querySelectorAll('[role="option"]')].find((b) => b.innerText.includes('自动审批'))).click(); 'ok'`);
await sleep(400);
await shot('08-permission-auto');

console.log('== 6. 模型选择器面板');
await evalJs(`(() => {
  const chips = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
  chips[chips.length - 1].click();
  return 'clicked';
})()`);
await sleep(500);
await shot('09-model-panel');
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'ok'`);
await sleep(400);

console.log('== 7. 发消息 → 运行状态行 → 错误卡片');
await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '你好，介绍一下你自己');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(300);
await evalJs(`document.querySelector('button[title="发送"]').click(); 'ok'`);
await waitFor('用户气泡渲染', `document.body.innerText.includes('你好，介绍一下你自己')`, 10000);
await waitFor('运行状态行', `document.body.innerText.includes('Working') || document.querySelector('.status-bar-shimmer') !== null`, 10000).catch(() => console.log('  （运行状态行可能已闪过，继续）'));
await shot('10-running-status');
await waitFor('错误卡片渲染', `document.querySelector('.bg-error-bg') !== null`, 90000);
await sleep(300);
await shot('11-error-card');

console.log('== 8. 深色：会话页 + 设置页');
await evalJs(`window.localStorage.setItem('fundet.theme', 'dark'); 'ok'`);
await evalJs(`window.location.reload(); 'ok'`);
await waitFor('深色就绪', `document.documentElement.dataset.theme === 'dark' && document.querySelector('aside') !== null`, 30000);
await evalJs(`(() => {
  const items = [...document.querySelectorAll('aside [role="button"]')];
  if (items.length === 0) return 'no-item';
  items[items.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'clicked';
})()`).then((r) => console.log('  切回会话:', r));
await waitFor('历史重建', `document.body.innerText.includes('你好，介绍一下你自己')`, 15000);
await sleep(400);
await shot('12-chat-dark');
await evalJs(`window.location.hash = '#/settings'; 'ok'`);
await waitFor('设置页深色', `document.body.innerText.includes('默认工作目录')`);
await shot('13-settings-dark');

console.log('== 9. 收尾：切回浅色 + 清理本次数据');
await evalJs(`window.localStorage.setItem('fundet.theme', 'light'); 'ok'`);
await evalJs(`(async () => {
  const list = await window.fundet.listProviders();
  for (const p of list.filter((x) => x.name === 'ui-calib-fake')) await window.fundet.deleteProvider(p.id);
  const sessions = await window.fundet.listSessions();
  for (const s of sessions.filter((x) => x.title === '新会话')) await window.fundet.deleteSession(s.id);
  return 'cleaned';
})()`);

console.log('ALL PASS');
ws.close();
process.exit(0);
