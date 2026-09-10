import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repairStreamingMarkdown, splitStreamingMarkdownChunks } from './streamingMarkdown.ts';

describe('repairStreamingMarkdown（④ 流式未闭合语法修复）', () => {
  it('未闭合 ``` 围栏在 EOF 补闭合', () => {
    const repaired = repairStreamingMarkdown('前言\n\n```js\nconst a = 1;');
    assert.equal(repaired, '前言\n\n```js\nconst a = 1;\n```');
  });

  it('已闭合围栏不动', () => {
    const src = '```js\nconst a = 1;\n```\n后文';
    assert.equal(repairStreamingMarkdown(src), src);
  });

  it('嵌套围栏长度判定：~~~ 内的三反引号不算闭合', () => {
    const repaired = repairStreamingMarkdown('~~~md\n```sh\necho hi');
    assert.equal(repaired.endsWith('\n~~~'), true);
  });

  it('EOF 半截图片标记摘掉', () => {
    assert.equal(repairStreamingMarkdown('看这个 ![截图](D:/pic'), '看这个 ');
  });

  it('EOF 半截链接摘掉，完整链接保留', () => {
    assert.equal(repairStreamingMarkdown('见 [文档](http://a.b 完'), '见 ');
    assert.equal(
      repairStreamingMarkdown('见 [文档](http://a.b)'),
      '见 [文档](http://a.b)',
    );
  });
});

describe('splitStreamingMarkdownChunks（⑤ 稳定前缀分块）', () => {
  it('空段落在围栏外切块，围栏内不切', () => {
    const text = '段落一\n\n段落二\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n段落三';
    const chunks = splitStreamingMarkdownChunks(text);
    assert.deepEqual(chunks, ['段落一', '段落二', '```js\nconst a = 1;\n\nconst b = 2;\n```', '段落三']);
  });

  it('围栏行自身成块，围栏未闭合也按围栏态隔离', () => {
    const chunks = splitStreamingMarkdownChunks('前文\n\n```js\nconst a = 1;');
    assert.deepEqual(chunks, ['前文', '```js\nconst a = 1;']);
  });

  it('相邻列表块合并成一块，保有序编号连续', () => {
    const chunks = splitStreamingMarkdownChunks('1. 第一\n\n2. 第二\n\n3. 第三');
    assert.equal(chunks.length, 1);
    assert.match(chunks[0]!, /^1\. 第一/);
  });

  it('列表与普通段落之间正常切分', () => {
    const chunks = splitStreamingMarkdownChunks('- 甲\n- 乙\n\n收尾段落');
    assert.deepEqual(chunks, ['- 甲\n- 乙', '收尾段落']);
  });

  it('拆分可逆：拼回等于原文', () => {
    const text = '# 标题\n\n正文一。\n\n```py\nx = 1\n\ny = 2\n```\n\n- 甲\n- 乙\n\n结尾';
    const chunks = splitStreamingMarkdownChunks(text);
    // 块间被消费掉的空行以块首/块尾形式保留可漂移，这里只验拼接内容等价
    assert.equal(chunks.join('\n\n').replace(/\n{3,}/g, '\n\n'), text.replace(/\n{3,}/g, '\n\n'));
  });

  it('流式增量下前缀块内容稳定（memo 命中的前提）', () => {
    const a = splitStreamingMarkdownChunks('# 标题\n\n第一段完整。\n\n第二段写到一半');
    const b = splitStreamingMarkdownChunks('# 标题\n\n第一段完整。\n\n第二段写到一半了，继续');
    assert.equal(a[0], b[0]);
    assert.equal(a[1], b[1]);
    assert.equal(a.length, b.length);
    assert.notEqual(a[a.length - 1], b[b.length - 1]);
  });
});
