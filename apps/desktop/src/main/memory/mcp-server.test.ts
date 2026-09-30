import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch } from './mcp-server.ts';
import { MEMORY_MCP_CALL_TOOL, MEMORY_MCP_LIST_TOOLS } from '../../shared/memory.ts';

const handlers = {
  listTools: async (args: Record<string, unknown>) => ({ text: `LIST:${String(args.category ?? 'all')}`, isError: false }),
  callTool: async (args: Record<string, unknown>) => ({ text: `CALL:${String(args.name)}`, isError: false }),
};

test('initialize 回 serverInfo fundet-memory', async () => {
  const r = (await dispatch({ id: 1, method: 'initialize' }, handlers)) as {
    result: { serverInfo: { name: string }; capabilities: { tools: unknown } };
  };
  assert.equal(r.result.serverInfo.name, 'fundet-memory');
  assert.ok(r.result.capabilities.tools);
});

test('tools/list 只暴露两个入口工具（渐进式发现）', async () => {
  const r = (await dispatch({ id: 2, method: 'tools/list' }, handlers)) as {
    result: { tools: Array<{ name: string; inputSchema: unknown }> };
  };
  assert.deepEqual(
    r.result.tools.map((t) => t.name).sort(),
    [MEMORY_MCP_CALL_TOOL, MEMORY_MCP_LIST_TOOLS],
  );
  for (const t of r.result.tools) assert.ok(t.inputSchema, '工具必须带 inputSchema');
});

test('tools/call 按名路由并把 handler 结果包进 content', async () => {
  const r = (await dispatch(
    { id: 3, method: 'tools/call', params: { name: MEMORY_MCP_CALL_TOOL, arguments: { name: 'memory_search', args: { query: 'x' } } } },
    handlers,
  )) as { result: { content: Array<{ type: string; text: string }>; isError: boolean } };
  assert.equal(r.result.content[0]?.text, 'CALL:memory_search');
  assert.equal(r.result.isError, false);
});

test('未知工具/未知方法回 JSON-RPC 错误；无 id 的消息返回 null（notification 静默）', async () => {
  const unknownTool = (await dispatch({ id: 4, method: 'tools/call', params: { name: 'nope' } }, handlers)) as {
    error: { code: number };
  };
  assert.equal(unknownTool.error.code, -32601);
  const unknownMethod = (await dispatch({ id: 5, method: 'xxx' }, handlers)) as { error: { code: number } };
  assert.equal(unknownMethod.error.code, -32601);
  assert.equal(await dispatch({ method: 'tools/list' }, handlers), null);
});
