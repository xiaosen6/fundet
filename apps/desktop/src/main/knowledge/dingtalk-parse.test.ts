/**
 * 钉钉知识库检索输出解析 + 动态工具组合单测。
 * aisearch 输出样本取自本机 dws v1.0.62 实跑（已脱敏）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDingtalkResults } from './dingtalk-format.ts';

const SAMPLE = JSON.stringify({
  arguments: [],
  errorCode: null,
  errorMsg: null,
  result: [
    {
      hostname: '文档',
      snippet: '目录: /钉钉使用手册/功能概览\n标题: 操作指南.adoc\n内容: 第一步打开设置',
    },
    {
      hostname: '消息',
      snippet: '标题: 群公告\n内容: 下周系统升级维护',
    },
  ],
});

describe('formatDingtalkResults', () => {
  it('命中格式化：编号 + 钉钉·来源类型 + 片段', () => {
    const out = formatDingtalkResults(SAMPLE, '操作指南', 5);
    assert.equal(out.isError, false);
    assert.match(out.text, /命中 2 条/);
    assert.match(out.text, /【1】来源：钉钉·文档/);
    assert.match(out.text, /操作指南\.adoc/);
    assert.match(out.text, /【2】来源：钉钉·消息/);
  });

  it('limit 截断', () => {
    const out = formatDingtalkResults(SAMPLE, 'q', 1);
    assert.match(out.text, /命中 1 条/);
  });

  it('空结果：如实未命中话术', () => {
    const out = formatDingtalkResults(JSON.stringify({ result: [] }), '不存在的东西');
    assert.equal(out.isError, false);
    assert.match(out.text, /没有找到/);
  });

  it('业务错误（errorCode）：透出原因；登录失效给提示', () => {
    const out = formatDingtalkResults(
      JSON.stringify({ errorCode: 401, errorMsg: 'auth token expired' }),
      'q',
    );
    assert.equal(out.isError, true);
    assert.match(out.text, /auth token expired/);
    assert.match(out.text, /重新登录/);
  });

  it('非 JSON 输出：解析失败话术', () => {
    const out = formatDingtalkResults('not json at all', 'q');
    assert.equal(out.isError, true);
    assert.match(out.text, /解析失败/);
  });
});
