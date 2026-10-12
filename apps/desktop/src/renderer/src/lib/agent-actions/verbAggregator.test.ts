import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateVerbs,
  formatSummary,
  ROW_VERB_TEXT,
  shortToolName,
  verbForTool,
} from './verbAggregator.ts';

describe('shortToolName / verbForTool', () => {
  it('MCP 前缀归一到短名再映射动词', () => {
    assert.equal(shortToolName('mcp__search__web_search'), 'web_search');
    assert.equal(verbForTool('mcp__search__web_search'), 'fetched');
    assert.equal(verbForTool('mcp__memory__bash'), 'ran');
  });

  it('pi 小写族与 CC 大写族都命中；未知工具回落 used', () => {
    assert.equal(verbForTool('bash'), 'ran');
    assert.equal(verbForTool('Bash'), 'ran');
    assert.equal(verbForTool('write'), 'created');
    assert.equal(verbForTool('Write'), 'created');
    assert.equal(verbForTool('todo'), 'updated');
    assert.equal(verbForTool('某工具'), 'used');
  });
});

describe('aggregateVerbs（聚合/排序/截断）', () => {
  it('动词按固定顺序输出，不随到达顺序漂移', () => {
    const a = aggregateVerbs(['read', 'bash', 'bash', 'write']);
    const b = aggregateVerbs(['write', 'bash', 'read', 'bash']);
    assert.deepEqual(a.verbs, b.verbs);
    assert.deepEqual(
      a.verbs.map((e) => e.verb),
      ['ran', 'read', 'created'],
    );
    assert.equal(a.totalCalls, 4);
    assert.equal(a.truncatedExtra, 0);
  });

  it('超过 5 个动词截断到 5 + truncatedExtra', () => {
    const s = aggregateVerbs(['edit', 'bash', 'read', 'todo', 'write', 'grep', 'web_search', '未知']);
    assert.equal(s.verbs.length, 5);
    assert.equal(s.truncatedExtra, 3);
    assert.equal(s.totalCalls, 8);
  });

  it('空列表产出空摘要', () => {
    assert.deepEqual(aggregateVerbs([]).verbs, []);
  });
});

describe('formatSummary（zh-CN 文案）', () => {
  it('单动词不加连接词；多动词「、」+「和」收尾', () => {
    assert.equal(formatSummary(aggregateVerbs(['bash', 'bash'])), '运行 2 条命令');
    assert.equal(
      formatSummary(aggregateVerbs(['write', 'bash', 'bash', 'read'])),
      '运行 2 条命令、读取 1 个文件和创建 1 个文件',
    );
  });

  it('截断尾部追加「另外 N 项」', () => {
    const s = aggregateVerbs(['edit', 'bash', 'read', 'todo', 'write', 'grep', 'web_search', '未知']);
    const text = formatSummary(s);
    assert.ok(text.endsWith('另外 3 项'), text);
  });

  it('updated/searched/fetched 无数量词（Cindy zh-CN 同文案）', () => {
    assert.ok(formatSummary(aggregateVerbs(['todo'])).includes('更新待办'));
    assert.ok(formatSummary(aggregateVerbs(['grep'])).includes('执行搜索'));
    assert.ok(formatSummary(aggregateVerbs(['web_search'])).includes('访问网络'));
  });

  it('行级动词文案齐备', () => {
    for (const v of ['edited', 'created', 'ran', 'read', 'updated', 'searched', 'fetched', 'used'] as const) {
      assert.ok(ROW_VERB_TEXT[v].length > 0, v);
    }
  });
});
