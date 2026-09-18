/**
 * IM 交互问答桥单测（规格搬自 Cindy dingtalk interaction __testing 行为）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __testing } from './im-interaction.ts';

const { formatInteractionPrompt, formatQuestionPrompt, parseQuestionAnswer, parseInteractionReply } = __testing;

describe('formatInteractionPrompt', () => {
  it('permission：工具名 + 允许/拒绝提示', () => {
    const text = formatInteractionPrompt({
      kind: 'permission',
      requestId: 'r1',
      toolName: 'write',
      input: {},
    } as never);
    assert.ok(text.includes('write'));
    assert.ok(text.includes('允许'));
    assert.ok(text.includes('拒绝'));
  });

  it('ask_user_question：题号 + 选项 + 答案指引', () => {
    const text = formatInteractionPrompt({
      kind: 'ask_user_question',
      requestId: 'r2',
      questions: [{ question: '用什么语言', options: [{ label: '中文' }, { label: 'English' }] }],
    } as never);
    assert.ok(text.includes('1. 用什么语言'));
    assert.ok(text.includes('1) 中文'));
    assert.ok(text.includes('选项序号'));
  });
});

describe('parseInteractionReply（permission）', () => {
  const req = { kind: 'permission', requestId: 'r', toolName: 'write', input: {} } as never;
  it('中文允许词表', () => {
    for (const w of ['允许', '同意', '确认', '继续', 'Allow', 'YES', 'y']) {
      assert.deepEqual(parseInteractionReply(req, w), { kind: 'permission', behavior: 'allow' }, w);
    }
  });
  it('中文拒绝词表', () => {
    for (const w of ['拒绝', '取消', 'Deny', 'no', 'N']) {
      assert.deepEqual(parseInteractionReply(req, w), { kind: 'permission', behavior: 'deny', reason: 'im_user_denied' }, w);
    }
  });
  it('不认识的词返回 null（重问）', () => {
    assert.equal(parseInteractionReply(req, '随便写点什么'), null);
    assert.equal(parseInteractionReply(req, ''), null);
  });
});

describe('parseQuestionAnswer', () => {
  const q = { question: '选哪个', options: [{ label: 'A 方案' }, { label: 'B 方案' }] } as never;
  it('序号 → 选项 label', () => {
    assert.equal(parseQuestionAnswer(q, '2'), 'B 方案');
    assert.equal(parseQuestionAnswer(q, ' 1 '), 'A 方案');
  });
  it('非序号 → 原文作答', () => {
    assert.equal(parseQuestionAnswer(q, '都不选，用 C'), '都不选，用 C');
  });
  it('空答 null', () => {
    assert.equal(parseQuestionAnswer(q, ''), null);
  });
});

describe('plan_review 回复解析', () => {
  const req = { kind: 'plan_review', requestId: 'r', plan: 'x' } as never;
  it('批准/拒绝词表', () => {
    assert.deepEqual(parseInteractionReply(req, '批准'), { kind: 'plan_review', behavior: 'allow' });
    assert.deepEqual(parseInteractionReply(req, '拒绝'), { kind: 'plan_review', behavior: 'deny', reason: 'im_user_denied' });
  });
});
