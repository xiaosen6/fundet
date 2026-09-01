/**
 * longma-file:// 预览地址。相对路径保留目录结构，HTML 里的 ./style.css 才能加载。
 *
 * 形态：longma-file://work/<base64url(workDir)>/<rel/posix/path>
 */

export const FILE_PROTOCOL_SCHEME = 'longma-file';
export const FILE_PROTOCOL_HOST = 'work';

export interface ParsedFilePreviewUrl {
  workDir: string;
  relPath: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isWindowsAbs(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

function isAbs(p: string): boolean {
  return isWindowsAbs(p) || p.startsWith('/');
}

function stripSlash(p: string): string {
  return toPosix(p).replace(/\/+$/u, '');
}

function posixRelative(root: string, target: string): string | null {
  const r = stripSlash(root);
  const t = toPosix(target);
  if (!r) return null;
  if (t === r) return '';
  const prefix = `${r}/`;
  const ignoreCase = isWindowsAbs(r);
  const hits = ignoreCase
    ? t.toLowerCase().startsWith(prefix.toLowerCase())
    : t.startsWith(prefix);
  if (!hits) return null;
  return t.slice(prefix.length);
}

export function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToUtf8(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 文件不在工作目录内时返回 null（协议层会 403）。 */
export function buildFilePreviewUrl(workDir: string, filePath: string): string | null {
  const root = stripSlash(workDir);
  if (!root || !filePath.trim()) return null;
  const resolved = isAbs(filePath) ? toPosix(filePath) : `${root}/${toPosix(filePath).replace(/^\.\//u, '')}`;
  const rel = posixRelative(root, resolved);
  if (rel === null) return null;
  const relEnc = rel
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${FILE_PROTOCOL_SCHEME}://${FILE_PROTOCOL_HOST}/${utf8ToBase64Url(root)}${relEnc ? `/${relEnc}` : ''}`;
}

export function parseFilePreviewUrl(url: string): ParsedFilePreviewUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${FILE_PROTOCOL_SCHEME}:`) return null;
  if (parsed.hostname !== FILE_PROTOCOL_HOST) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 1) return null;
  try {
    const workDir = base64UrlToUtf8(parts[0]!);
    const relPath = parts
      .slice(1)
      .map((seg) => decodeURIComponent(seg))
      .join('/');
    if (!workDir) return null;
    return { workDir, relPath };
  } catch {
    return null;
  }
}
