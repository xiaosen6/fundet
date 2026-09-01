import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_MCP_TOOL_NAME } from '../../shared/search-engines.ts';
import { startSearchMcpServer } from './mcp-server.ts';

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
): Promise<{ status: number; json: unknown; session: string | null }> {
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
  return {
    status: res.status,
    json: text ? JSON.parse(text) : null,
    session: res.headers.get('mcp-session-id'),
  };
}

describe('search MCP server', () => {
  it('rejects missing bearer, then initialize / list / call', async () => {
    const token = 'test-token';
    const calls: unknown[] = [];
    const { url, dispose } = await startSearchMcpServer(token, logger, async (args) => {
      calls.push(args);
      return { text: JSON.stringify({ engine: 'tavily', results: [] }), isError: false };
    });
    try {
      const denied = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      });
      assert.equal(denied.status, 401);

      const init = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't' } },
      });
      assert.equal(init.status, 200);
      assert.equal(init.session, 'fundet-search');
      const initBody = init.json as { result?: { serverInfo?: { name?: string } } };
      assert.equal(initBody.result?.serverInfo?.name, 'fundet-search');

      const note = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      assert.equal(note.status, 202);

      const listed = await rpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const tools = (listed.json as { result: { tools: Array<{ name: string }> } }).result.tools;
      assert.equal(tools[0]?.name, SEARCH_MCP_TOOL_NAME);

      const called = await rpc(url, token, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: SEARCH_MCP_TOOL_NAME, arguments: { query: 'Fundet', limit: 3 } },
      });
      const result = (called.json as { result: { isError: boolean; content: Array<{ text: string }> } })
        .result;
      assert.equal(result.isError, false);
      assert.match(result.content[0]?.text ?? '', /tavily/);
      assert.deepEqual(calls, [{ query: 'Fundet', limit: 3 }]);
    } finally {
      dispose();
    }
  });
});
