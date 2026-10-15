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

/** 两层仓依赖：getStore 按 scope 键分发到项目仓/全局仓两个假 store */
const twoStoreDeps = (project: MemoryStoreLike, global: MemoryStoreLike) => ({
  isEnabled: () => true,
  getStore: (dir: string) => Promise.resolve(dir === '_global' ? global : project),
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

  // 两层仓：list/search 会同时查项目仓与全局仓（本测试单 store 兼任两仓 → 各记两次）
  assert.deepEqual(calls, [
    'list',
    'list',
    'read:user_pref.md',
    'search:偏好',
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

// ── 两层仓（项目 + 全局）──

test('write 默认路由：user/feedback→全局仓，project/reference→项目仓，scope 可覆盖', async () => {
  const calls: string[] = [];
  const mk = (tag: string) =>
    fakeStore({
      write: async (o) => {
        calls.push(`${tag}:${o.type}`);
        return { filename: `${o.type}_${o.name}.md` };
      },
    });
  const h = createMemoryToolHandlers(twoStoreDeps(mk('project'), mk('global')));
  const w = (type: string, scope?: string) =>
    h.callTool({ name: 'memory_write', args: { type, name: 'n', title: 't', description: 'd', body: 'b', ...(scope ? { scope } : {}) } });

  const r1 = await w('user');
  assert.ok(r1.text.includes('全局仓'), r1.text);
  const r2 = await w('feedback');
  assert.ok(r2.text.includes('全局仓'), r2.text);
  const r3 = await w('project');
  assert.ok(r3.text.includes('项目仓'), r3.text);
  const r4 = await w('reference');
  assert.ok(r4.text.includes('项目仓'), r4.text);
  const r5 = await w('project', 'global');
  assert.ok(r5.text.includes('全局仓'), r5.text);
  assert.deepEqual(calls, ['global:user', 'global:feedback', 'project:project', 'project:reference', 'global:project']);
});

test('list 合并两仓并带仓位标记；search 合并两仓；read 项目未命中回落全局', async () => {
  const project = fakeStore({
    list: async () => [],
    search: async () => [],
    read: async () => {
      throw new Error('memory:not-found nope');
    },
  });
  const global = fakeStore();
  const h = createMemoryToolHandlers(twoStoreDeps(project, global));

  const list = await h.callTool({ name: 'memory_list' });
  assert.ok(list.text.includes('项目仓 0 / 全局仓 1'), list.text);
  assert.ok(list.text.includes('（全局仓）'), list.text);

  const hit = await h.callTool({ name: 'memory_search', args: { query: '命中' } });
  assert.ok(hit.text.includes('[全局]'), hit.text);

  const read = await h.callTool({ name: 'memory_read', args: { filename: 'user_pref.md' } });
  assert.ok(!read.isError && read.text.includes('全局仓'), read.text);
});

test('delete 默认项目仓；目标在全局仓时要求显式 scope 确认（防误删共享记忆）', async () => {
  const calls: string[] = [];
  const project = fakeStore({
    delete: async (f) => {
      calls.push(`project:${f}`);
      throw new Error('memory:not-found nope');
    },
  });
  const global = fakeStore({
    delete: async (f) => {
      calls.push(`global:${f}`);
    },
  });
  const h = createMemoryToolHandlers(twoStoreDeps(project, global));

  const blocked = await h.callTool({ name: 'memory_delete', args: { filename: 'user_pref.md' } });
  assert.ok(blocked.isError && blocked.text.includes('NOT_FOUND_IN_PROJECT'), blocked.text);
  assert.deepEqual(calls, ['project:user_pref.md']);

  const okDel = await h.callTool({ name: 'memory_delete', args: { filename: 'user_pref.md', scope: 'global' } });
  assert.ok(okDel.text.includes('全局仓'), okDel.text);
  assert.deepEqual(calls, ['project:user_pref.md', 'global:user_pref.md']);
});
