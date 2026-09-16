import fs from 'node:fs';
import path from 'node:path';
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  FILE_PROTOCOL_SCHEME,
  parseFilePreviewUrl,
} from '../shared/file-preview-url.ts';
import { assertPreviewablePath } from './filePathPolicy.js';

export function registerFileProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerFileProtocolHandler(): void {
  protocol.handle(FILE_PROTOCOL_SCHEME, async (request) => {
    const parsed = parseFilePreviewUrl(request.url);
    if (!parsed) return new Response('Bad request', { status: 400 });
    try {
      // deny-list 策略（对齐 Cindy：系统/敏感目录外全放行；relPath 相对 workDir 解析）
      const rel = parsed.relPath || '.';
      const resolved = assertPreviewablePath(
        path.isAbsolute(rel) ? rel : path.resolve(parsed.workDir, rel),
      );
      if (!(await fs.promises.stat(resolved)).isFile()) {
        return new Response('Not a file', { status: 404 });
      }
      const range = request.headers.get('Range');
      const headers: Record<string, string> = {};
      if (range) headers.Range = range;
      return await net.fetch(pathToFileURL(resolved).href, {
        bypassCustomProtocolHandlers: true,
        headers,
      });
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  });
}
