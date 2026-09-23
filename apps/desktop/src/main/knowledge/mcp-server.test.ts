import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_MCP_TOOL_NAME, KNOWLEDGE_MCP_LIST_TOOL_NAME } from '../../shared/knowledge.ts';
import { startKnowledgeMcpServer } from './mcp-server.ts';

const logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
};

async function rpc(
  url: string,
  token: string,
  msg: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(msg),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('knowledge MCP server', () => {
  it('tools/list 按绑定动态组合（只勾钉钉 → 仅 dingtalk_kb_search）', async () => {
    const { url, dispose } = await startKnowledgeMcpServer('t2', logger, {
      dingtalk: async () => ({ text: '钉钉侧没有找到相关内容。', isError: false }),
    });
    try {
      const list = await rpc(url, 't2', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const tools = (list.json as { result: { tools: Array<{ name: string }> } }).result.tools;
      assert.deepEqual(tools.map((t) => t.name), ['dingtalk_kb_search']);
      const call = await rpc(url, 't2', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'dingtalk_kb_search', arguments: { query: 'x' } },
      });
      assert.equal((call.json as { result: { isError: boolean } }).result.isError, false);
    } finally {
      dispose();
    }
  });

  it('rejects missing bearer, then initialize / list / call', async () => {
    const token = 'test-token';
    const calls: Array<Record<string, unknown>> = [];
    const { url, dispose } = await startKnowledgeMcpServer(token, logger, {
      search: async (args) => {
        calls.push(args);
        return {
          text: '【1】来源：制度.docx（第 2 块）\n退货流程如下',
          isError: false,
        };
      },
      list: async () => ({
        text: '本会话绑定了 1 个本地知识库：\n\n## 制度库（1 份文档）\n- 制度.docx（5 块 / 12000 字）',
        isError: false,
      }),
    });
    try {
      const denied = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      });
      assert.equal(denied.status, 401);

      const init = await rpc(url, token, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      assert.equal(init.status, 200);
      const info = (init.json as { result: { serverInfo: { name: string } } }).result.serverInfo;
      assert.equal(info.name, 'fundet-knowledge');

      const list = await rpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const tools = (list.json as { result: { tools: Array<{ name: string }> } }).result.tools;
      assert.deepEqual(tools.map((t) => t.name), [KNOWLEDGE_MCP_TOOL_NAME, KNOWLEDGE_MCP_LIST_TOOL_NAME]);

      const call = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: KNOWLEDGE_MCP_TOOL_NAME, arguments: { query: '退货流程', limit: 3 } },
      });
      assert.equal(call.status, 200);
      const result = (call.json as {
        result: { content: Array<{ text: string }>; isError: boolean };
      }).result;
      assert.equal(result.isError, false);
      assert.match(result.content[0]!.text, /退货流程如下/);
      assert.deepEqual(calls[0], { query: '退货流程', limit: 3 });

      const listCall = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 3.5,
        method: 'tools/call',
        params: { name: KNOWLEDGE_MCP_LIST_TOOL_NAME, arguments: {} },
      });
      assert.match(
        (listCall.json as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
        /制度库（1 份文档）[\s\S]*制度\.docx/,
      );

      const unknown = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'other', arguments: {} },
      });
      assert.equal(
        (unknown.json as { error: { code: number } }).error.code,
        -32601,
      );
    } finally {
      dispose();
    }
  });

  it('surfaces handler errors as isError results', async () => {
    const token = 't';
    const { url, dispose } = await startKnowledgeMcpServer(token, logger, {
      search: async () => ({ text: '当前会话没有绑定知识库。', isError: true }),
      list: async () => ({ text: '当前会话没有绑定知识库。', isError: true }),
    });
    try {
      const call = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: KNOWLEDGE_MCP_TOOL_NAME, arguments: { query: 'x' } },
      });
      const result = (call.json as {
        result: { content: Array<{ text: string }>; isError: boolean };
      }).result;
      assert.equal(result.isError, true);
      assert.match(result.content[0]!.text, /没有绑定知识库/);
    } finally {
      dispose();
    }
  });
});
