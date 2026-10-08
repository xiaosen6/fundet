import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSharePngWriter } from './sharePng.ts';

type MockImage = { isEmpty: () => boolean };

/** 拼最小 PNG 头（魔数 + IHDR 长度/标记 + 宽高），尾部零填充凑长度 */
function pngHeader(width: number, height: number, size = 32): ArrayBuffer {
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  out.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  const dv = new DataView(out.buffer);
  dv.setUint32(8, 13);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return out.buffer;
}

/** 注入 clipboard/nativeImage mock，返回 writer 与写入记录 */
function makeWriter(image: MockImage = { isEmpty: () => false }) {
  const writes: Array<{ image: MockImage; text?: string }> = [];
  const writer = makeSharePngWriter({
    clipboard: { write: (v) => { writes.push(v); } },
    nativeImage: { createFromBuffer: () => image },
  });
  return { writer, writes };
}

test('CLIPBOARD_WRITE_PNG：入参校验 + clipboard 写入（mock 注入）', async (t) => {
  await t.test('有效 PNG + 纯文本 → 一次写入 image+text 双表示', () => {
    const { writer, writes } = makeWriter();
    writer(pngHeader(1120, 640), '问题\n\n回答');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].text, '问题\n\n回答');
    assert.equal(writes[0].image.isEmpty(), false);
  });

  await t.test('纯文本缺省/空串 → 只写 image，不携带 text 键', () => {
    const { writer, writes } = makeWriter();
    writer(pngHeader(10, 10));
    writer(pngHeader(10, 10), '');
    assert.equal(writes.length, 2);
    assert.ok(!('text' in writes[0]));
    assert.ok(!('text' in writes[1]));
  });

  await t.test('坏魔数 / 缺 IHDR / 截断 / 空入参 → 拒收且不写剪贴板', () => {
    const { writer, writes } = makeWriter();
    const badMagic = pngHeader(10, 10);
    new Uint8Array(badMagic)[0] = 0x42;
    assert.throws(() => writer(badMagic), /不是有效的 PNG/);
    const badChunk = pngHeader(10, 10);
    new Uint8Array(badChunk).set([0x49, 0x48, 0x44, 0x45], 12);
    assert.throws(() => writer(badChunk), /不是有效的 PNG/);
    assert.throws(() => writer(new ArrayBuffer(8)), /不是有效的 PNG/);
    assert.throws(() => writer(undefined as unknown as ArrayBuffer), /不是有效的 PNG/);
    assert.equal(writes.length, 0);
  });

  await t.test('尺寸预算：0 边 / 超 16384 / 面积超 4096² → 拒收', () => {
    const { writer } = makeWriter();
    assert.throws(() => writer(pngHeader(0, 10)), /尺寸超出上限/);
    assert.throws(() => writer(pngHeader(20000, 10)), /尺寸超出上限/);
    assert.throws(() => writer(pngHeader(4097, 4100)), /尺寸超出上限/);
    assert.doesNotThrow(() => writer(pngHeader(4096, 4096)));
  });

  await t.test('nativeImage 解码为空图 → 拒收且不写剪贴板', () => {
    const { writer, writes } = makeWriter({ isEmpty: () => true });
    assert.throws(() => writer(pngHeader(10, 10)), /PNG 解码失败/);
    assert.equal(writes.length, 0);
  });
});
