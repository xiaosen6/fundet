/**
 * 预览能力授权（CDS Epitaxy 沙箱对齐）——longma-file 请求只信主进程签发的
 * opaque capability，不再把 workDir 明文嵌进 URL 让渲染层自由拼造。
 *
 * 形态：longma-file://work/<randomToken>/<rel/posix/path>。token 128 位随机数，
 * 主进程内存 LRU 持有授权范围；HTML 文档按文档目录授权根（相对 JS/CSS 可加载），
 * 其它类型按单文件授权（同目录兄弟文件不可替换读取）。
 *
 * 与 filePathPolicy 的关系：签发与请求两侧都过 assertPreviewablePath（deny-list
 * 防系统目录/凭据/浏览器 profile），能力之上再钉死授权范围（realpath 防符号链接
 * 逃逸）。能力是会话内易失的（重启即失效）——渲染层持 URL 按需重签发。
 *
 * 本文件刻意无 Electron 依赖：node --test 直跑 TS 源（desktop 测试链）。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertPreviewablePath } from './filePathPolicy.ts';

export const PREVIEW_SCHEME = 'longma-file';
export const PREVIEW_HOST = 'work';

/** 授权能力：HTML 文档给「文档目录根」范围（相对资源可加载）；其余给单文件。 */
export type PreviewCapability = {
  token: string;
  /** 'document-root' = HTML 文档的目录根；'file' = 单文件精确路径 */
  kind: 'document-root' | 'file';
  /** 授权范围的 realpath 绝对路径（document-root=目录，file=文件） */
  scopeRealPath: string;
  /** 签发文件的 realpath 绝对路径（document-root 时即文档本体） */
  fileRealPath: string;
  createdAt: number;
  lastTouchedAt: number;
};

/** 签发入参。workDir 仅在 filePath 相对时作为解析基准；绝对路径不依赖它。 */
export interface IssuePreviewInput {
  filePath: string;
  workDir?: string;
}

/** 请求解析结果。 */
export interface ParsedPreviewRequest {
  token: string;
  relPath: string;
}

function isHtmlPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 边界包含判定（大小写不敏感对齐 Windows 文件系统语义；Linux 上调用方须注意大小写）。 */
function isPathInside(root: string, target: string): boolean {
  const r = normalizeSlashes(path.resolve(root));
  const t = normalizeSlashes(path.resolve(target));
  if (t === r) return true;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return t.toLowerCase().startsWith(prefix.toLowerCase());
}

/** 分段 decode 相对路径；任何编码错误/绝对形态/穿越都拒绝。 */
function decodeRelPath(segments: string[]): string | null {
  const parts: string[] = [];
  for (const seg of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (!decoded || decoded === '.' || decoded === '..') return null;
    if (decoded.includes('/') || decoded.includes('\\')) return null;
    parts.push(decoded);
  }
  return parts.join('/');
}

/** 解析 longma-file URL；token 不解码（不透明），relPath 逐段校验解码。 */
export function parsePreviewRequestUrl(url: string): ParsedPreviewRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PREVIEW_SCHEME}:`) return null;
  if (parsed.hostname !== PREVIEW_HOST) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 1) return null;
  const token = segments[0]!;
  const relPath = decodeRelPath(segments.slice(1));
  if (relPath === null && segments.length > 1) return null;
  return { token, relPath: relPath ?? '' };
}

/** 构造能力 URL（token + POSIX 编码路径）。 */
export function buildCapabilityUrl(token: string, relPath: string): string {
  const enc = relPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${PREVIEW_SCHEME}://${PREVIEW_HOST}/${encodeURIComponent(token)}${enc ? `/${enc}` : ''}`;
}

/** LRU 上限：足够一次长会话的所有产物+资源，防止不可信页面刷 token 撑内存。 */
const REGISTRY_LIMIT = 512;

/** 内存能力注册表（注入式，测试可带假 clock / random）。 */
export function createPreviewRegistry(options?: {
  randomToken?: () => string;
  now?: () => number;
  limit?: number;
}): {
  issue: (input: IssuePreviewInput) => Promise<{ url: string; capability: PreviewCapability }>;
  resolve: (url: string) => Promise<string | null>;
  size: () => number;
  dispose: () => void;
} {
  const limit = options?.limit ?? REGISTRY_LIMIT;
  const now = options?.now ?? (() => Date.now());
  const randomToken = options?.randomToken ?? (() => randomBytes(16).toString('base64url'));
  const registry = new Map<string, PreviewCapability>();

  function evictOverflow(): void {
    while (registry.size > limit) {
      let oldestKey: string | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [key, cap] of registry) {
        if (cap.lastTouchedAt < oldest) {
          oldest = cap.lastTouchedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      registry.delete(oldestKey);
    }
  }

  async function issue(input: IssuePreviewInput): Promise<{ url: string; capability: PreviewCapability }> {
    const raw = input.filePath.trim();
    if (!raw) throw new Error('文件路径为空');
    const initial = path.isAbsolute(raw)
      ? raw
      : input.workDir
        ? path.resolve(input.workDir, raw)
        : raw;
    // deny-list：系统目录/凭据/浏览器 profile 在签发时即拒绝
    const previewable = assertPreviewablePath(initial);
    // realpath 钉死授权范围：符号链接目标变了也按签发时解析的位置授权
    const fileRealPath = await fs.promises.realpath(previewable);
    const stat = await fs.promises.stat(fileRealPath);
    if (!stat.isFile()) throw new Error('不是文件');
    const scopeRealPath = isHtmlPath(fileRealPath)
      ? path.dirname(fileRealPath)
      : fileRealPath;
    const kind: PreviewCapability['kind'] = isHtmlPath(fileRealPath) ? 'document-root' : 'file';

    // 幂等：同一真实路径已授权则复用同一 token（URL 稳定，防重复签发刷注册表）
    for (const cap of registry.values()) {
      if (cap.fileRealPath === fileRealPath && cap.kind === kind) {
        cap.lastTouchedAt = now();
        const rel = kind === 'document-root' ? path.relative(scopeRealPath, fileRealPath) : '';
        const relPosix = normalizeSlashes(rel).replace(/^\/+/, '');
        return { url: buildCapabilityUrl(cap.token, relPosix), capability: cap };
      }
    }

    let token = randomToken();
    while (registry.has(token)) token = randomToken();
    const capability: PreviewCapability = {
      token,
      kind,
      scopeRealPath,
      fileRealPath,
      createdAt: now(),
      lastTouchedAt: now(),
    };
    registry.set(token, capability);
    evictOverflow();
    const rel = kind === 'document-root' ? path.relative(scopeRealPath, fileRealPath) : '';
    const relPosix = normalizeSlashes(rel).replace(/^\/+/, '');
    return { url: buildCapabilityUrl(token, relPosix), capability };
  }

  async function resolve(url: string): Promise<string | null> {
    const parsed = parsePreviewRequestUrl(url);
    if (!parsed) return null;
    const cap = registry.get(parsed.token);
    if (!cap) return null;
    // 每请求重算 realpath：签发后目录里的符号链接变了也不能借道逃逸
    const candidate = parsed.relPath
      ? path.join(cap.scopeRealPath, ...parsed.relPath.split('/'))
      : cap.fileRealPath;
    let real: string;
    try {
      // 请求侧再过 deny-list（防签发后目标被替换成敏感路径）
      real = await fs.promises.realpath(assertPreviewablePath(candidate));
    } catch {
      return null;
    }
    const stat = await fs.promises.stat(real).catch(() => null);
    if (!stat || !stat.isFile()) return null;
    if (cap.kind === 'file') {
      if (real !== cap.scopeRealPath) return null;
    } else if (!isPathInside(cap.scopeRealPath, real)) {
      return null;
    }
    cap.lastTouchedAt = now();
    return real;
  }

  return {
    issue,
    resolve,
    size: () => registry.size,
    dispose: () => registry.clear(),
  };
}
