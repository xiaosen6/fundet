/**
 * 工作目录内文件解析、附件落入 .fundet-uploads。
 */
import fs from 'node:fs';
import path from 'node:path';
import { uniqueDestName } from '../shared/file-name.ts';
import { isImagePath, mimeFromExt, sendBlockKind, sniffImageMime } from '../shared/file-kind.ts';
import type { SessionAttachment } from '../shared/fundet-api.ts';

export const UPLOADS_DIR = '.fundet-uploads';
const MAX_STAGE_BYTES = 32 * 1024 * 1024;

export function isPathInsideRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveUnderWorkDir(filePath: string, workDir: string): string {
  if (!workDir?.trim()) throw new Error('未指定工作目录');
  const root = path.resolve(workDir);
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (!isPathInsideRoot(root, resolved)) {
    throw new Error('只能预览当前工作目录内的文件');
  }
  if (!fs.existsSync(resolved)) throw new Error('文件不存在');
  return resolved;
}

/** 图片附件读头部字节做真实格式嗅探（QQ"原图"常是 PNG 套 .jpeg 名） */
function readImageHead(filePath: string): Uint8Array | undefined {
  if (!isImagePath(filePath)) return undefined;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const read = fs.readSync(fd, buf, 0, 16, 0);
      return read > 0 ? buf.subarray(0, read) : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function toAttachment(
  filePath: string,
  size: number,
  name?: string,
  head?: Uint8Array,
): SessionAttachment {
  const n = name || path.basename(filePath);
  const kind = sendBlockKind(filePath, size);
  return {
    path: filePath,
    name: n,
    kind,
    mimeType:
      kind === 'image' && head
        ? sniffImageMime(head, mimeFromExt(filePath))
        : mimeFromExt(filePath),
    size,
  };
}

export async function stageFileIntoWorkDir(srcPath: string, workDir: string): Promise<SessionAttachment> {
  if (!workDir?.trim()) throw new Error('未指定工作目录');
  const root = path.resolve(workDir);
  const src = path.resolve(srcPath);
  if (!fs.existsSync(src)) throw new Error('文件不存在');
  const stat = fs.statSync(src);
  if (!stat.isFile()) throw new Error('不是文件');
  if (isPathInsideRoot(root, src)) {
    return toAttachment(src, stat.size, undefined, readImageHead(src));
  }
  const destDir = path.join(root, UPLOADS_DIR);
  fs.mkdirSync(destDir, { recursive: true });
  const existing = new Set(fs.readdirSync(destDir).map((n) => n.toLowerCase()));
  const destName = uniqueDestName(existing, path.basename(src));
  const dest = path.join(destDir, destName);
  await fs.promises.copyFile(src, dest);
  return toAttachment(dest, stat.size, destName, readImageHead(dest));
}

export function stageBytesIntoWorkDir(
  workDir: string,
  originalName: string,
  data: Uint8Array,
): SessionAttachment {
  if (!workDir?.trim()) throw new Error('未指定工作目录');
  if (data.byteLength > MAX_STAGE_BYTES) {
    throw new Error(`粘贴内容超过 ${Math.round(MAX_STAGE_BYTES / (1024 * 1024))}MB`);
  }
  const root = path.resolve(workDir);
  const destDir = path.join(root, UPLOADS_DIR);
  fs.mkdirSync(destDir, { recursive: true });
  const existing = new Set(fs.readdirSync(destDir).map((n) => n.toLowerCase()));
  const destName = uniqueDestName(existing, originalName || `paste-${Date.now()}`);
  const dest = path.join(destDir, destName);
  fs.writeFileSync(dest, data);
  return toAttachment(dest, data.byteLength, destName, data.subarray(0, 16));
}
