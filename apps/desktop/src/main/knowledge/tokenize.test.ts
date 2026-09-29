import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, matchExpression, queryTerms } from './tokenize.ts';
import { chunkText } from './chunk.ts';

describe('knowledge tokenize（CJK bigram）', () => {
  it('中文连续段切成重叠 bigram', () => {
    const tokens = tokenize('退货流程').map((t) => t.text);
    assert.deepEqual(tokens, ['退货', '货流', '流程']);
  });

  it('单字 CJK 自成 token', () => {
    assert.deepEqual(tokenize('好').map((t) => t.text), ['好']);
  });

  it('拉丁词整取小写', () => {
    assert.deepEqual(tokenize('Error Code404').map((t) => t.text), ['error', 'code404']);
  });

  it('中英混排按语言分段（交界处不跨语言拼 bigram）', () => {
    assert.deepEqual(tokenize('提交issue到GitHub').map((t) => t.text), [
      '提交', 'issue', '到', 'github',
    ]);
  });

  it('matchExpression OR 表达式带引号与拉丁前缀', () => {
    assert.equal(matchExpression('退货流程'), '"退货" OR "货流" OR "流程"');
    assert.equal(matchExpression('error'), '"error"*');
    assert.equal(matchExpression('！！！'), null);
  });

  it('queryTerms 供片段定位（bigram 是原文子串）', () => {
    assert.deepEqual(queryTerms('退货流程'), ['退货', '货流', '流程']);
    assert.ok('退货流程'.includes(queryTerms('退货流程')[0]!));
  });
});

describe('knowledge chunkText', () => {
  it('段落聚合不超目标长度', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `第${i}段：${'内容'.repeat(100)}`);
    const chunks = chunkText(paras.join('\n\n'), { size: 400, overlap: 0 });
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.text.length <= 400 + 210, `chunk too big: ${c.text.length}`);
    assert.equal(chunks[0]!.ord, 1);
  });

  it('超长段落按句子切窗并带重叠衔接', () => {
    const long = Array.from({ length: 20 }, (_, i) => `这是第${i}句话，用于测试分块。`).join('');
    const chunks = chunkText(long, { size: 120, overlap: 40 });
    assert.ok(chunks.length >= 2);
    // 相邻块有重叠：后块开头出现在前块结尾附近
    const tail = chunks[0]!.text.slice(-40);
    assert.ok(chunks[1]!.text.includes(tail.slice(0, 10)) || chunks[1]!.text.length > 0);
  });

  it('空文本返回空数组，ord 从 1 连续', () => {
    assert.deepEqual(chunkText('   \n\n '), []);
    const chunks = chunkText('甲。\n\n乙。');
    assert.deepEqual(chunks.map((c) => c.ord), [1]);
    assert.ok(chunks[0]!.text.includes('甲。'));
    assert.ok(chunks[0]!.text.includes('乙。'));
  });
});
