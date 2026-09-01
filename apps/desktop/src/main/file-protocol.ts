import fs from 'node:fs';
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  FILE_PROTOCOL_SCHEME,
  parseFilePreviewUrl,
} from '../shared/file-preview-url.ts';
import { resolveUnderWorkDir } from './fs-local.js';

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
      const resolved = resolveUnderWorkDir(parsed.relPath || '.', parsed.workDir);
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
