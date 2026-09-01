/**
 * 把 zip 解到目标目录。不依赖系统 unzip / python。
 * 支持 STORE 与 DEFLATE。解压后逐条核对路径，防止 zip-slip。
 */
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export function assertPathInside(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`非法路径（越出解压目录）: ${target}`);
  }
}

export function extractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  extractZipBuffer(fs.readFileSync(zipPath), destDir);
  walkAndAssert(destDir, destDir);
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('不是有效的 zip 文件');
}

function extractZipBuffer(buf: Buffer, destDir: string): void {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 8);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error('zip 目录损坏');
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    off += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) continue;

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error(`zip 条目损坏: ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`不支持的 zip 压缩方法 ${method}（${name}）`);

    const dest = path.join(destDir, ...name.split('/'));
    assertPathInside(destDir, dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

function walkAndAssert(root: string, dir: string): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    assertPathInside(root, full);
    if (ent.isSymbolicLink()) {
      throw new Error(`zip 内不允许符号链接: ${path.relative(root, full)}`);
    }
    if (ent.isDirectory()) walkAndAssert(root, full);
  }
}

/** zip 根或「唯一一层文件夹」里找指定文件名（大小写不敏感） */
export function findEntryInExtract(root: string, fileName: string): string | null {
  const want = fileName.toLowerCase();
  const direct = fs.readdirSync(root);
  const hit = direct.find((n) => n.toLowerCase() === want);
  if (hit) return path.join(root, hit);
  const dirs = direct.filter((n) => fs.statSync(path.join(root, n)).isDirectory());
  if (dirs.length === 1) {
    const inner = path.join(root, dirs[0]!);
    const innerHit = fs.readdirSync(inner).find((n) => n.toLowerCase() === want);
    if (innerHit) return path.join(inner, innerHit);
  }
  return null;
}
