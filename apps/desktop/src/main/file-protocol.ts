import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  PREVIEW_SCHEME,
  createPreviewRegistry,
} from './file-preview-authorization.ts';

/**
 * longma-file:// 预览协议（能力授权版）。
 *
 * 安全模型（2026-10-19，对齐 CDS Epitaxy「null-origin + 主进程签发能力」）：
 * - URL 不再内嵌 workDir 明文（渲染层可自由拼造 = 任意可读文件口子），只带主进程
 *   签发的随机 token；授权范围（文档目录根 / 单文件）只存主进程内存。
 * - HTML 预览 iframe 走 opaque origin（CanvasPane 已去 allow-same-origin），配
 *   supportFetchAPI:false —— 沙箱内 fetch/XHR 拿不到响应体；CORS 头只对浏览器
 *   子资源（script/font）放行，让相对 ES module 与字体仍可加载。
 * - 请求侧每条 URL 都经 realpath + deny-list 复核（防签发后链接改指敏感目标）。
 */

const registry = createPreviewRegistry();

/** 签发预览能力 URL（renderer 经 fs:create-preview-url IPC 调用；拒绝时抛错）。 */
export function issuePreviewUrl(filePath: string, workDir?: string): Promise<string> {
  return registry.issue({ filePath, workDir }).then((issued) => issued.url);
}

export function registerFileProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        // fetch/XHR 不暴露响应体（不可信 HTML 沙箱内拿不到文件内容）
        supportFetchAPI: false,
        // 相对 <script>/<link> 子资源加载需要 CORS 通道；响应头按 Sec-Fetch-Dest 精确放行
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerFileProtocolHandler(): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    const resolved = await registry.resolve(request.url);
    if (!resolved) return new Response('Forbidden', { status: 403 });

    const range = request.headers.get('Range');
    const headers: Record<string, string> = {};
    if (range) headers.Range = range;
    const upstream = await net.fetch(pathToFileURL(resolved).href, {
      bypassCustomProtocolHandlers: true,
      headers,
    });
    // CORS 只给 script/font 子资源（相对 ES module / @font-face 需要）；document/
    // image/media 与 fetch/XHR（Sec-Fetch-Dest: empty）一律不带，避免不可信 HTML
    // 借 CORS 读到授权文件内容。Vary 防同一响应被缓存复用到不同 CORS 语义的请求。
    const dest = request.headers.get('Sec-Fetch-Dest') ?? '';
    if (dest === 'script' || dest === 'font') {
      const withCors = new Headers(upstream.headers);
      withCors.set('Access-Control-Allow-Origin', '*');
      withCors.append('Vary', 'Sec-Fetch-Dest');
      return new Response(upstream.body, { status: upstream.status, headers: withCors });
    }
    return upstream;
  });
}

export function disposePreviewRegistry(): void {
  registry.dispose();
}
