import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryToolHandlers, type MemoryStoreLike } from './handlers.ts';

function fakeStore(overrides: Partial<MemoryStoreLike> = {}): MemoryStoreLike {
  return {
    list: async () => [
      {
        filename: 'user_pref.md',
        slug: 'pref',
        frontmatter: { title: '偏好', description: '喜欢简洁', type: 'user', updatedAt: '2026-09-30T00:00:00.000Z' },
        body: '回答要简洁',
        sizeBytes: 100,
      },
    ],
    read: async (f) => {
      if (f !== 'user_pref.md') throw new Error('memory:not-found nope');
      return {
        filename: 'user_pref.md',
        slug: 'pref',
        frontmatter: { title: '偏好', description: '喜欢简洁', type: 'user', updatedAt: '2026-09-30T00:00:00.000Z' },
        body: '回答要简洁',
        sizeBytes: 100,
      };
    },
    write: async (opts) => ({ filename: `${opts.type}_${opts.name}.md` }),
    delete: async () => undefined,
    search: async (q) =>
      q === '命中'
        ? [{ filename: 'user_pref.md', type: 'user', title: '偏好', snippet: '回答要<b>简洁</b>', score: -1 }]
        : [],
    consolidate: async (opts) => ({ filename: `${opts.target.type}_${opts.target.name}.md`, deletedSources: opts.sources }),
    ...overrides,
  } as MemoryStoreLike;
}

const baseDeps = (store: MemoryStoreLike) => ({
  isEnabled: () => true,
  getStore: () => Promise.resolve(store),
  memoryScopeDir: 'C:/Users/x',
});

test('未启用时两个入口都返回 MAKER_MEMORY_NOT_READY', async () => {
  const h = createMemoryToolHandlers({ ...baseDeps(fakeStore()), isEnabled: () => false });
  const a = await h.listTools({});
  assert.ok(a.isError && a.text.includes('MAKER_MEMORY_NOT_READY'));
  const b = await h.callTool({ name: 'memory_list' });
  assert.ok(b.isError && b.text.includes('MAKER_MEMORY_NOT_READY'));
});

test('listTools：全量列出六内工具；category 过滤；未知类目报错', async () => {
  const h = createMemoryToolHandlers(baseDeps(fakeStore()));
  const all = await h.listTools({});
  assert.ok(!all.isError);
  for (const name of ['memory_list', 'memory_read', 'memory_write', 'memory_delete', 'memory_search', 'memory_consolidate']) {
    assert.ok(all.text.includes(name), `应含 ${name}`);
  }
  const read = await h.listTools({ category: 'read' });
  assert.ok(read.text.includes('memory_read'));
  assert.ok(!read.text.includes('memory_write'));
  const bad = await h.listTools({ category: 'xxx' });
  assert.ok(bad.isError && bad.text.includes('INVALID_PARAMS'));
});

test('callTool 分发：list/read/search/write/delete/consolidate 各走对 store 方法', async () => {
  const calls: string[] = [];
  const store = fakeStore({
    list: async () => {
      calls.push('list');
      return [];
    },
    read: async (f) => {
      calls.push(`read:${f}`);
      return fakeStore().read(f);
    },
    search: async (q) => {
      calls.push(`search:${q}`);
      return [];
    },
    write: async (o) => {
      calls.push(`write:${o.name}`);
      return { filename: `${o.type}_${o.name}.md` };
    },
    delete: async (f) => {
      calls.push(`delete:${f}`);
    },
    consolidate: async (o) => {
      calls.push(`consolidate:${o.sources.length}`);
      return { filename: 'x.md', deletedSources: o.sources };
    },
  });
  const h = createMemoryToolHandlers(baseDeps(store));

  await h.callTool({ name: 'memory_list' });
  await h.callTool({ name: 'memory_read', args: { filename: 'user_pref.md' } });
  await h.callTool({ name: 'memory_search', args: { query: '偏好' } });
  const w = await h.callTool({
    name: 'memory_write',
    args: { type: 'user', name: 'style', title: 't', description: 'd', body: 'b' },
  });
  assert.ok(w.text.includes('user_style.md'));
  await h.callTool({ name: 'memory_delete', args: { filename: 'user_pref.md' } });
  const c = await h.callTool({
    name: 'memory_consolidate',
    args: { sources: ['a.md', 'b.md'], target: { type: 'user', name: 'm', title: 't', description: 'd', body: 'b' } },
  });
  assert.ok(c.text.includes('删除源 2 条'));

  assert.deepEqual(calls, [
    'list',
    'read:user_pref.md',
    'search:偏好',
    'write:style',
    'delete:user_pref.md',
    'consolidate:2',
  ]);
});

test('store 抛错转 isError 文本（不炸通道）；未知工具名报 INVALID_PARAMS', async () => {
  const h = createMemoryToolHandlers(baseDeps(fakeStore()));
  const nf = await h.callTool({ name: 'memory_read', args: { filename: 'ghost.md' } });
  assert.ok(nf.isError && nf.text.includes('not-found'));
  const unknown = await h.callTool({ name: 'memory_fly' });
  assert.ok(unknown.isError && unknown.text.includes('INVALID_PARAMS'));
  const missing = await h.callTool({});
  assert.ok(missing.isError);
});

test('search 命中格式带片段；未命中提示不要编造', async () => {
  const h = createMemoryToolHandlers(baseDeps(fakeStore()));
  const hit = await h.callTool({ name: 'memory_search', args: { query: '命中' } });
  assert.ok(hit.text.includes('偏好') && hit.text.includes('简洁'));
  const miss = await h.callTool({ name: 'memory_search', args: { query: 'miss' } });
  assert.ok(miss.text.includes('不要编造'));
});
