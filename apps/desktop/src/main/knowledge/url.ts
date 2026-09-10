/**
 * URL 快照的抓取与安全前置：只允许公网 http(s)，解析全部地址逐个校验
 * （拦 localhost / RFC1918 / 链路本地 / 云元数据），对齐 §4.4 SSRF 立场。
 * 正文用 html-to-text 提取（纯字符串，无 DOM 依赖）。
 */
import dns from 'node:dns/promises';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 3 * 1024 * 1024;

function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '::') return true;
  // IPv4-mapped IPv6（::ffff:10.0.0.1 等）
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] ?? address;
  const m4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v4);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local（含云元数据 169.254.169.254）
    if (a >= 224) return true; // 组播/保留
    return false;
  }
  const low = address.toLowerCase();
  if (low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')) return true;
  return false;
}

/** 校验 URL 形态 + 解析全部地址，任何违规直接抛错（fail-closed） */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('URL 格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http(s) 链接');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('禁止抓取本机/内网地址');
  }
  // 字面 IP 直接判；域名逐条解析后判（防 DNS rebind 只查一次不够，但快照场景
  // 单次校验 + 不复用连接已是合理防线）
  if (/^[\d.]+$/.test(host)) {
    if (isPrivateAddress(host)) throw new Error('禁止抓取内网/保留地址');
    return url;
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`域名解析失败：${host}`);
  }
  if (addrs.length === 0) throw new Error(`域名解析失败：${host}`);
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error('目标域名解析到内网/保留地址，已拦截');
    }
  }
  return url;
}

/** 抓取页面并提取正文（标题 + 纯文本） */
export async function fetchPageText(raw: string): Promise<{ title: string; text: string }> {
  const url = await assertPublicHttpUrl(raw);
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Fundet knowledge snapshot)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_BYTES) throw new Error('页面过大（>3MB）');
  const html = (await res.text()).slice(0, MAX_BYTES);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || url.hostname;
  const { convert } = await import('html-to-text');
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('页面没有可提取的正文');
  return { title: title.slice(0, 80), text: text.slice(0, 200_000) };
}
