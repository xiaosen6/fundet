/**
 * 钉钉入站解析单测（规格搬自 Cindy dingtalkIM.test 的关键行为）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInboundContent, parseInboundEnvelope } from './dingtalk-inbound.ts';

const baseRaw = {
  conversationId: 'cid-1',
  conversationType: '1',
  msgId: 'm-1',
  msgtype: 'text',
  robotCode: 'rc',
  senderStaffId: 'staff-1',
  senderNick: '张三',
  sessionWebhook: 'https://oapi.dingtalk.com/hook',
  sessionWebhookExpiredTime: 1893456000000,
  text: { content: ' 你好 ' },
};

describe('parseInboundEnvelope', () => {
  it('文本消息：完整信封字段 + mentioned 单聊恒真', () => {
    const env = parseInboundEnvelope(baseRaw);
    assert.ok(env);
    assert.equal(env!.conversationId, 'cid-1');
    assert.equal(env!.conversationType, '1');
    assert.equal(env!.senderId, 'staff-1');
    assert.equal(env!.senderName, '张三');
    assert.equal(env!.sessionWebhook, 'https://oapi.dingtalk.com/hook');
    assert.ok(env!.sessionWebhookExpiresAt! > Date.now());
    assert.equal(env!.mentioned, true); // 单聊不需要 @，恒真（text 含 @ 或 isInAtList 均真；无 @ 时单聊仍可回复）
  });

  it('缺会话/发送者身份返回 null（拒收不完整信封）', () => {
    assert.equal(parseInboundEnvelope({ ...baseRaw, conversationId: '' }), null);
    assert.equal(parseInboundEnvelope({ ...baseRaw, senderStaffId: '', senderId: '' }), null);
    assert.equal(parseInboundEnvelope(null), null);
  });

  it('群聊未 @ 时 mentioned=false', () => {
    const env = parseInboundEnvelope({ ...baseRaw, conversationType: '2', isInAtList: false });
    assert.ok(env);
    assert.equal(env!.mentioned, false);
  });
});

describe('parseInboundContent', () => {
  it('text：trim 后正文', () => {
    const env = parseInboundEnvelope(baseRaw)!;
    const c = parseInboundContent(env);
    assert.equal(c.text, '你好');
    assert.deepEqual(c.downloadCodes, []);
  });

  it('picture：downloadCode 提取', () => {
    const env = parseInboundEnvelope({
      ...baseRaw,
      msgtype: 'picture',
      content: { downloadCode: 'dc-1' },
    })!;
    const c = parseInboundContent(env);
    assert.equal(c.text, '');
    assert.deepEqual(c.downloadCodes, ['dc-1']);
  });

  it('richText：递归抽文本与图片', () => {
    const env = parseInboundEnvelope({
      ...baseRaw,
      msgtype: 'richText',
      content: {
        richText: [
          { type: 'text', text: '看这张图' },
          { type: 'picture', downloadCode: 'dc-2' },
          { children: [{ type: 'text', text: '第二段' }] },
        ],
      },
    })!;
    const c = parseInboundContent(env);
    assert.equal(c.text, '看这张图 第二段');
    assert.deepEqual(c.downloadCodes, ['dc-2']);
  });

  it('audio：有识别文字则当文本', () => {
    const env = parseInboundEnvelope({ ...baseRaw, msgtype: 'audio', recognition: '语音内容' })!;
    assert.equal(parseInboundContent(env).text, '语音内容');
  });

  it('video/file/未知类型 → 不支持清单', () => {
    for (const t of ['video', 'file', 'sticker']) {
      const env = parseInboundEnvelope({ ...baseRaw, msgtype: t })!;
      const c = parseInboundContent(env);
      assert.equal(c.text, '');
      assert.equal(c.downloadCodes.length, 0);
      assert.equal(c.unsupported.length, 1);
    }
  });
});
