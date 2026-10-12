import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortToolName, summarizeLatestWork } from './work-summary.ts';

const tool = (toolName: string, input: Record<string, unknown>) => ({ kind: 'tool' as const, toolName, input });
const think = { kind: 'thinking' as const };

describe('shortToolName', () => {
  it('MCP 双下划线取末段；普通名原样', () => {
    assert.equal(shortToolName('mcp__fundet__bash'), 'bash');
    assert.equal(shortToolName('bash'), 'bash');
  });
});

describe('summarizeLatestWork（折叠头最新动作）', () => {
  it('取最后一个 tool：bash 给命令首行（多行取首个非空行）', () => {
    assert.equal(
      summarizeLatestWork([tool('read', { path: 'D:\\w\\a.ts' }), tool('bash', { command: 'node gen_pptx.js\n--out x' })]),
      'node gen_pptx.js',
    );
  });

  it('超长命令截断加省略号', () => {
    const long = 'x'.repeat(120);
    const out = summarizeLatestWork([tool('bash', { command: long })]);
    assert.ok(out !== null && out.endsWith('…') && out.length <= 92);
  });

  it('文件类工具给「动词 文件名」；MCP 前缀归一', () => {
    assert.equal(summarizeLatestWork([tool('write', { path: 'D:\\w\\gen.js' })]), '编辑 gen.js');
    assert.equal(summarizeLatestWork([tool('mcp__fundet__read', { file_path: 'D:/w/报告.docx' })]), '读取 报告.docx');
  });

  it('已知动词映射；未知工具回落短名', () => {
    assert.equal(summarizeLatestWork([tool('todo', {})]), '更新计划');
    assert.equal(summarizeLatestWork([tool('grep', { pattern: 'x' })]), '搜索内容');
    assert.equal(summarizeLatestWork([tool('some_weird_tool', {})]), 'some_weird_tool');
  });

  it('纯思考段无动作返回 null', () => {
    assert.equal(summarizeLatestWork([think, think]), null);
    assert.equal(summarizeLatestWork([]), null);
  });
});
