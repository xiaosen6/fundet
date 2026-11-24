/**
 * 把 tar.gz 解成内存条目。不依赖系统 tar（bsdtar 经 node spawn 吃反斜杠路径
 * 必炸），也不落盘——安装包先在内存里校验，通过了再写文件（zip-extract 的
 * gzip 版同类）。
 *
 * 支持 ustar 前缀、GNU 长文件名（L）与 PAX 路径（x）；目录与链接/设备等特殊
 * 类型不产出条目（只搬普通文件）。路径统一成 posix 相对形式，`..`/绝对路径/
 * 反斜杠一律拒绝。
 */
import { gunzipSync } from 'node:zlib';

export interface TgzEntry {
  /** 归档内路径（posix 分隔符，已去首部 ./ 与尾部 /） */
  path: string;
  data: Buffer;
}

const BLOCK = 512;

/** 八进制字段；GNU base-256（首字节高位 1）按不支持处理——本项目用不到 */
function octal(header: Buffer, start: number, length: number): number | null {
  const raw = header.subarray(start, start + length);
  if (raw.length === 0 || (raw[0]! & 0x80) !== 0) return null;
  const text = raw.toString('utf8').replace(/\0[\s\S]*$/, '').trim();
  if (!text) return 0;
  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : null;
}

/** PAX 扩展头是 `<长度> key=value\n` 记录序列，只认 path */
function paxPath(data: Buffer): string | null {
  const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
  return m ? m[1]! : null;
}

function normalizeArchivePath(name: string): string {
  const segments: string[] = [];
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || seg.includes('\\')) {
      throw new Error(`归档里的非法路径：${name.slice(0, 160)}`);
    }
    segments.push(seg);
  }
  if (segments.length === 0 || /^[A-Za-z]:/.test(segments[0]!)) {
    throw new Error(`归档里的非法路径：${name.slice(0, 160)}`);
  }
  return segments.join('/');
}

export function extractTgz(buf: Buffer): TgzEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(buf);
  } catch {
    throw new Error('不是有效的 gzip 压缩包');
  }
  const out: TgzEntry[] = [];
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;
  let off = 0;
  // 归档以两个全零块收尾（也容忍直接到头）
  while (off + BLOCK <= tar.length) {
    const header = tar.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    if (size === null) throw new Error('tar 头损坏（size 字段非法）');
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('tar 条目被截断');
    const data = Buffer.from(tar.subarray(dataStart, dataEnd));
    const type = String.fromCharCode(header[156] ?? 0x30);

    if (type === 'L') {
      pendingLongName = data.toString('utf8').replace(/\0+$/, '');
    } else if (type === 'x') {
      pendingPaxPath = paxPath(data);
    } else if (type === '0' || type === '\0' || type === '7') {
      let name = pendingLongName ?? pendingPaxPath;
      if (name === null) {
        name = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0[\s\S]*$/, '');
        // prefix 字段是 ustar 起才有的；v7 归档该区域是别的内容
        if (prefix && header.subarray(257, 262).toString('latin1') === 'ustar') {
          name = `${prefix}/${name}`;
        }
      }
      pendingLongName = null;
      pendingPaxPath = null;
      out.push({ path: normalizeArchivePath(name), data });
    } else {
      // 5=目录、K=长链接名、g=全局 PAX 头：忽略；1/2=链接、3/4=设备、其它特殊类型：
      // 不产出（技能包里出现链接属于被篡改，由调用方的文件数与内容指纹兜住）
      pendingLongName = null;
      pendingPaxPath = null;
    }
    off = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return out;
}
