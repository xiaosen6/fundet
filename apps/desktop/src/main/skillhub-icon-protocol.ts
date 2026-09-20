/**
 * skillhub-icon:// 协议：技能集市图标的主进程代理。
 *
 * 为什么不直接放行 CSP https: 图片——那会连带改变聊天内容的远程图加载行为
 * （任意服务器直连）。此协议只接受主进程白名单域（腾讯系 CDN），单文件 ≤1MB、
 * 魔数校验、磁盘缓存（userData/skillhub-icons），renderer 零直连。
 */
import path from 'node:path';
import { app, protocol } from 'electron';
import { fetchSkillhubIcon, sniffImageType } from './host/skillhub.ts';

export const SKILLHUB_ICON_SCHEME = 'skillhub-icon';

export function registerSkillhubIconPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SKILLHUB_ICON_SCHEME,
      privileges: { standard: true, secure: true, corsEnabled: true },
    },
  ]);
}

export function registerSkillhubIconProtocolHandler(): void {
  protocol.handle(SKILLHUB_ICON_SCHEME, async (request) => {
    try {
      const u = new URL(request.url);
      // skillhub-icon://host/path → 还原 https URL（query/fragment 丢弃）
      const httpsUrl = `https://${u.host}${u.pathname}`;
      const cacheDir = path.join(app.getPath('userData'), 'skillhub-icons');
      const bytes = await fetchSkillhubIcon(httpsUrl, cacheDir);
      const contentType = bytes ? sniffImageType(bytes) : null;
      if (!bytes || !contentType) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=86400' },
      });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}
