/**
 * tgz 解包器单测：归档在测试里现写（512 字节头 + 校验和 + gzip），不依赖系统 tar，
 * 覆盖 ustar 前缀、GNU 长文件名、PAX 路径三种长路径形态与非法路径拒绝。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { extractTgz } from './tgz-extract.ts';

function tarHeader(name: string, size: number, type = '0', prefix = ''): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  if (prefix) h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

function file(name: string, data: string, type = '0', prefix = ''): Buffer[] {
  const d = Buffer.from(data, 'utf8');
  const pad = (512 - (d.length % 512)) % 512;
  return [tarHeader(name, d.length, type, prefix), d, Buffer.alloc(pad)];
}

function archive(...entries: Buffer[][]): Buffer {
  return gzipSync(Buffer.concat([...entries.flat(), Buffer.alloc(1024)]));
}

/** ustar 拆分：找一个 '/' 使前缀 ≤155 且余下 ≤100 */
function ustarSplit(full: string): { name: string; prefix: string } {
  const cut = full.lastIndexOf('/', 99);
  assert.ok(cut > 0 && cut <= 155, '测试路径应能按 ustar 规则拆分');
  return { prefix: full.slice(0, cut), name: full.slice(cut + 1) };
}

describe('extractTgz', () => {
  it('普通文件解出路径与内容；目录条目不产出', () => {
    const tgz = archive(
      file('package/', '', '5'),
      file('package/package.json', '{"name":"x"}'),
      file('package/bin/tool.exe', 'MZ-fake'),
    );
    const entries = extractTgz(tgz);
    assert.deepEqual(
      entries.map((e) => e.path),
      ['package/package.json', 'package/bin/tool.exe'],
    );
    assert.equal(entries[1]!.data.toString('utf8'), 'MZ-fake');
  });

  it('空文件（size=0）照常产出', () => {
    const entries = extractTgz(archive(file('a/empty', '')));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.data.length, 0);
  });

  it('首部 ./ 与多余分隔符被规整', () => {
    const entries = extractTgz(archive(file('././x/./y.txt', 'hi')));
    assert.equal(entries[0]!.path, 'x/y.txt');
  });

  it('ustar 前缀：超过 100 字符的路径由 prefix+name 拼回', () => {
    const full = `wecom-cli-f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-pptx/assets/templates/broadside/slides/01_cover.slide`;
    assert.ok(full.length > 100);
    const { name, prefix } = ustarSplit(full);
    const entries = extractTgz(archive(file(name, 'slide', '0', prefix)));
    assert.deepEqual(entries.map((e) => [e.path, e.data.toString()]), [[full, 'slide']]);
  });

  it('GNU 长文件名（L 条目）覆盖下一条的 name 字段', () => {
    const long = `${'deep/'.repeat(24)}leaf.md`;
    const tgz = archive(
      file('././@LongLink', `${long}\0`, 'L'),
      [tarHeader('deep/deep/truncated-name', 2), Buffer.from('ok'), Buffer.alloc(510)],
    );
    const entries = extractTgz(tgz);
    assert.deepEqual(entries.map((e) => [e.path, e.data.toString()]), [[long, 'ok']]);
  });

  it('PAX 扩展头（x 条目）的 path 覆盖下一条', () => {
    const long = `${'pax/'.repeat(30)}file.txt`;
    const record = `${Buffer.byteLength(`${28 + long.length} path=${long}\n`) + long.length} path=${long}\n`;
    const tgz = archive(
      file('PaxHeaders/x', record, 'x'),
      [tarHeader('short', 2), Buffer.from('ok'), Buffer.alloc(510)],
    );
    const entries = extractTgz(tgz);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.path, long);
  });

  it('符号链接与硬链接不产出条目', () => {
    const tgz = archive(file('package/link', '', '1'), file('package/hard', '', '2'), file('package/real', 'r'));
    assert.deepEqual(extractTgz(tgz).map((e) => e.path), ['package/real']);
  });

  it('拒绝越界路径（..）与反斜杠', () => {
    assert.throws(() => extractTgz(archive(file('../evil.sh', 'x'))), /非法路径/);
    assert.throws(() => extractTgz(archive(file('a/../../evil', 'x'))), /非法路径/);
    assert.throws(() => extractTgz(archive(file('a\\b.txt', 'x'))), /非法路径/);
  });

  it('绝对路径与盘符路径不会被原样放行：前导 / 规整成相对，盘符开头拒绝', () => {
    assert.equal(extractTgz(archive(file('/etc/passwd', 'x')))[0]!.path, 'etc/passwd');
    assert.throws(() => extractTgz(archive(file('C:/Windows/system32/x.dll', 'x'))), /非法路径/);
  });

  it('非 gzip 与截断的归档给出中文错误', () => {
    assert.throws(() => extractTgz(Buffer.from('not a gzip')), /不是有效的 gzip/);
    // 截掉尾部数据块：头声明 11 字节但归档只剩头 → 条目被截断
    const tar = Buffer.concat([tarHeader('a.txt', 11)]);
    assert.throws(() => extractTgz(gzipSync(tar)), /截断/);
  });
});
