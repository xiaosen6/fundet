/**
 * Cindy 桌面端参照截图 CDP 驱动（开发工具，非产品代码）。
 *
 * 前提：Cindy desktop dev 已启动且 CDP 端口可连（dev 默认 9222，可用
 * CDP_PORT 环境变量覆写）。通过 CDP 对 renderer page 做：
 *   node tools/cindy-cdp.mjs targets                 列出 CDP targets
 *   node tools/cindy-cdp.mjs shot <file>             截当前页面到 PNG
 *   node tools/cindy-cdp.mjs eval '<js>'             在页面里执行 JS，打印返回值
 *   node tools/cindy-cdp.mjs click-text '<text>'     点击包含指定文字的可点元素
 *   node tools/cindy-cdp.mjs sleep <ms>              等待（便于链式脚本）
 */
import fs from 'node:fs';

const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;

async function getPageWsUrl() {
  const targets = await (await fetch(`${BASE}/json`)).json();
  const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (pages.length === 0) throw new Error('no page target');
  // 主窗口是不带辅助窗口 query 参数的 vite 页面（resourceUsageWindow 等是隐藏辅助窗）。
  const main = pages.find((t) => !/[?&](resourceUsageWindow|hidden|helper)=/.test(t.url)) ?? pages[0];
  return { pages, wsUrl: main.webSocketDebuggerUrl };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'targets') {
  const targets = await (await fetch(`${BASE}/json`)).json();
  for (const t of targets) console.log(`${t.type}\t${t.id}\t${t.url}\t${t.title}`);
  process.exit(0);
}

const { pages, wsUrl } = await getPageWsUrl();
if (pages.length > 1) {
  console.error('multiple pages:');
  for (const p of pages) console.error(`  ${p.url}  ${p.title}`);
}
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
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, (msg) => {
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp('Page.enable');
await cdp('Runtime.enable');

async function evalJs(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)}`);
  }
  return result.result.value;
}

async function shot(file) {
  // 等两帧，降低动画中间态概率。
  await evalJs('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`saved ${file} (${fs.statSync(file).size} bytes)`);
}

if (cmd === 'shot') {
  await shot(args[0]);
} else if (cmd === 'eval') {
  const value = await evalJs(args[0]);
  console.log(JSON.stringify(value, null, 2));
} else if (cmd === 'click-text') {
  const text = args[0];
  const clicked = await evalJs(`(() => {
    const needle = ${JSON.stringify(text)};
    const all = [...document.querySelectorAll('button, [role="button"], a, [role="menuitem"], [role="option"], [role="tab"], li, span, div, p')];
    const el = all.find((e) => {
      const t = (e.innerText || '').trim();
      if (!t.includes(needle)) return false;
      // 只点叶子级命中，避免点到外层容器
      return ![...e.children].some((c) => (c.innerText || '').includes(needle));
    });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { tag: el.tagName, text: (el.innerText || '').trim().slice(0, 80), cls: String(el.className).slice(0, 80) };
  })()`);
  console.log(JSON.stringify(clicked));
} else if (cmd === 'sleep') {
  await new Promise((r) => setTimeout(r, Number(args[0])));
} else {
  console.error('unknown command:', cmd);
  process.exit(1);
}

ws.close();
process.exit(0);
