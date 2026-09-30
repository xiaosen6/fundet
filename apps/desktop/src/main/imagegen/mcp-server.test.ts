import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch } from './mcp-server.ts';
import { IMAGEGEN_TOOL_NAME } from '../../shared/imagegen.ts';

const handlers = {
  generateImage: async (args: Record<string, unknown>) => ({ text: `GEN:${String(args.prompt)}`, isError: false }),
};

test('tools/list 单工具带 inputSchema', async () => {
  const r = (await dispatch({ id: 1, method: 'tools/list' }, handlers)) as {
    result: { tools: Array<{ name: string; inputSchema: unknown }> };
  };
  assert.equal(r.result.tools.length, 1);
  assert.equal(r.result.tools[0].name, IMAGEGEN_TOOL_NAME);
  assert.ok(r.result.tools[0].inputSchema);
});

test('tools/call 路由到 generate_image；未知工具报错；无 id 静默', async () => {
  const r = (await dispatch(
    { id: 2, method: 'tools/call', params: { name: IMAGEGEN_TOOL_NAME, arguments: { prompt: '猫' } } },
    handlers,
  )) as { result: { content: Array<{ text: string }> } };
  assert.equal(r.result.content[0].text, 'GEN:猫');
  const bad = (await dispatch({ id: 3, method: 'tools/call', params: { name: 'nope' } }, handlers)) as {
    error: { code: number };
  };
  assert.equal(bad.error.code, -32601);
  assert.equal(await dispatch({ method: 'tools/list' }, handlers), null);
});
