/**
 * 微信入站媒体辅助单测：MIME 嗅探 + 图片/附件分流 + 下载降级文字合成（不静默吞）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeInboundText, sniffImageMime, splitInboundMedia } from './wechat-inbound.ts';
import type { WechatMediaRef } from './wechat-ilink/types.ts';

function mediaRef(kind: WechatMediaRef['kind'], extra: Partial<WechatMediaRef> = {}): WechatMediaRef {
  return { kind, ...extra };
}

describe('sniffImageMime', () => {
  it('按魔数识别 png/jpeg/gif/webp', () => {
    assert.equal(
      sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])),
      'image/png',
    );
    assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01])), 'image/gif');
    assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])), 'image/gif');
    assert.equal(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
      'image/webp',
    );
  });

  it('空/未知字节默认 jpeg（微信 C2C 图主流格式）', () => {
    assert.equal(sniffImageMime(new Uint8Array()), 'image/jpeg');
    assert.equal(sniffImageMime(new Uint8Array([1, 2, 3, 4])), 'image/jpeg');
  });
});

describe('splitInboundMedia', () => {
  it('图片与其余附件分流', () => {
    const { images, otherCount } = splitInboundMedia([
      mediaRef('image'),
      mediaRef('file'),
      mediaRef('video'),
      mediaRef('image'),
    ]);
    assert.equal(images.length, 2);
    assert.equal(otherCount, 2);
  });

  it('带识别文字的语音不算附件缺口（正文已在 text）', () => {
    const { images, otherCount } = splitInboundMedia([mediaRef('voice', { transcript: '你好' })]);
    assert.equal(images.length, 0);
    assert.equal(otherCount, 0);
  });

  it('无识别文字的语音计入附件', () => {
    assert.equal(splitInboundMedia([mediaRef('voice')]).otherCount, 1);
    assert.equal(splitInboundMedia([mediaRef('voice', { transcript: '  ' })]).otherCount, 1);
  });
});

describe('composeInboundText', () => {
  it('无失败无附件：原文原样返回（不 trim）', () => {
    assert.equal(composeInboundText('  你好  ', { total: 1, failed: 0, otherCount: 0 }), '  你好  ');
    assert.equal(composeInboundText('  你好  ', { total: 0, failed: 0, otherCount: 0 }), '  你好  ');
  });

  it('纯图全失败：产出给模型的降级说明（含原因）', () => {
    const text = composeInboundText('', { total: 2, failed: 2, reason: 'HTTP 403', otherCount: 0 });
    assert.match(text, /用户发来 2 张图片但下载失败（HTTP 403），无法查看图片内容。/);
  });

  it('部分失败：原文 + 总数/失败数/收到数', () => {
    const text = composeInboundText('看这几张图', { total: 3, failed: 1, reason: 'HTTP 500', otherCount: 0 });
    assert.match(text, /^看这几张图\n/);
    assert.match(text, /3 张图片，其中 1 张下载失败（HTTP 500），仅收到 2 张。/);
  });

  it('非图片附件：附文字说明', () => {
    const text = composeInboundText('收到没', { total: 0, failed: 0, otherCount: 2 });
    assert.match(text, /^收到没\n用户还发来 2 个非图片附件（文件\/视频\/语音），内容暂无法读取。/);
  });

  it('图片失败与非图片附件说明可叠加', () => {
    const text = composeInboundText('', { total: 1, failed: 1, reason: 'bad decrypt', otherCount: 1 });
    assert.match(text, /用户发来 1 张图片但下载失败（bad decrypt）/);
    assert.match(text, /用户还发来 1 个非图片附件/);
  });
});
