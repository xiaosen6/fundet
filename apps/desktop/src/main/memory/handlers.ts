/**
 * 记忆 MCP 的工具实现层：list_tools（渐进式发现目录）+ call_tool（六内工具分发）。
 *
 * 依赖全部注入（node --test 可用假 store 直测）；类型仅 type-import 自
 * agent-core（编译期擦除，不进 node --test 运行时链）。
 * 使用规范改编自 Cindy maker-core/src/memory/system-prompt.md（何时存/不存/怎么存）。
 */
import type {
  MemoryRecord,
  MemoryType,
  SearchHit,
  WriteResult,
} from '@fundet/agent-core';
import { MEMORY_GLOBAL_SCOPE_KEY, MEMORY_GLOBAL_TYPES } from '../../shared/memory.ts';
import type { MemoryMcpHandlers, MemoryToolOutput } from './mcp-server.ts';

/** store 结构子集（MakerMemoryStore 的可注入面） */
export interface MemoryStoreLike {
  list(): Promise<MemoryRecord[]>;
  read(filename: string): Promise<MemoryRecord>;
  write(opts: {
    type: MemoryType;
    name: string;
    title: string;
    description: string;
    body: string;
    mode?: 'create' | 'update' | 'append';
  }): Promise<WriteResult>;
  delete(filename: string): Promise<void>;
  search(query: string, opts?: { limit?: number }): Promise<SearchHit[]>;
  consolidate(opts: {
    sources: string[];
    target: {
      type: MemoryType;
      name: string;
      title: string;
      description: string;
      body: string;
      mode?: 'create' | 'update' | 'append';
    };
  }): Promise<{ filename: string; deletedSources: string[]; warning?: string }>;
}

export interface MemoryHandlerDeps {
  isEnabled(): boolean;
  getStore(scopeDir: string): Promise<MemoryStoreLike>;
  /** 本会话的记忆仓作用域目录 */
  memoryScopeDir: string;
}

interface InnerToolSpec {
  category: 'read' | 'write' | 'maintain' | 'search';
  description: string;
  args: string;
}

const WRITE_GUIDE =
  '记忆分两层：项目仓（当前工作目录）+ 全局仓（跨目录跨会话共享）。何时存：学到跨会话值得回忆的东西才存。' +
  'user=用户角色/目标/偏好（默认进全局仓）；feedback=纠偏，body 必须含 **Why:** 与 **How to apply:**（默认进全局仓）；' +
  'project=本目录项目的决策/约束/进行中事项（进项目仓）；reference=外部系统指针（进项目仓）。强信号：用户说"记住/别再/以后都/我希望"。' +
  '何时不存：代码结构、文件路径、git 历史、进行中的任务进度（用计划/待办）。写不出一行 description 就不值得存。' +
  '写入可用 scope:"global"|"project" 显式指定仓位，缺省按上述类型路由。';

const INNER_TOOLS: Record<string, InnerToolSpec> = {
  memory_list: {
    category: 'read',
    description: `列出项目仓 + 全局仓的全部条目（类型/标题/一行描述/更新时间/大小，全局条目带标记），可按 type 过滤。想了解"已记住了什么"先调本工具。digest 类型是系统自动沉淀的压缩摘要。`,
    args: '{type?: "user"|"feedback"|"project"|"reference"|"digest"}',
  },
  memory_read: {
    category: 'read',
    description: '读取一条记忆的完整内容（正文 markdown）。默认先查项目仓，未命中自动查全局仓；也可用 scope 显式指定。',
    args: '{filename: string, scope?: "project"|"global"}',
  },
  memory_search: {
    category: 'search',
    description: '按关键词全文检索（自动合并项目仓与全局仓，结果带仓位标记，FTS 排序）。回答涉及历史偏好/决策时先检索。',
    args: '{query: string, limit?: number}',
  },
  memory_write: {
    category: 'write',
    description: `写入/更新一条记忆。${WRITE_GUIDE} 新建前先 memory_list 查重，已有相关条目改用 mode:"update"。name 是 [a-z0-9_-] 文件名 slug（英文），title 才是中文标题。`,
    args: '{type, name, title, description, body, mode?: "create"|"update"|"append", scope?: "project"|"global"}',
  },
  memory_delete: {
    category: 'maintain',
    description: '删除一条过时/错误的记忆。删除前先 memory_read 确认内容。默认删项目仓；目标在全局仓时必须显式传 scope:"global"（防误删共享记忆）。',
    args: '{filename: string, scope?: "project"|"global"}',
  },
  memory_consolidate: {
    category: 'maintain',
    description: '把多条相关记忆原子合并为一条（源条目会被删除），用于清理碎片或瘦身超限条目。仅在同一仓内合并，scope 缺省 project。',
    args: '{sources: string[], target: {type, name, title, description, body}, scope?: "project"|"global"}',
  },
};

function ok(text: string): MemoryToolOutput {
  return { text, isError: false };
}
function fail(text: string): MemoryToolOutput {
  return { text, isError: true };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function createMemoryToolHandlers(deps: MemoryHandlerDeps): MemoryMcpHandlers {
  const notReady = (): MemoryToolOutput =>
    fail('MAKER_MEMORY_NOT_READY：记忆功能未启用，请提示用户在应用的「记忆」面板开启。');

  const projectStore = (): Promise<MemoryStoreLike> => deps.getStore(deps.memoryScopeDir);
  const globalStore = (): Promise<MemoryStoreLike> => deps.getStore(MEMORY_GLOBAL_SCOPE_KEY);
  const isNotFound = (err: unknown): boolean => /not[-_]?found/i.test(errMessage(err));
  const scopeLabel = (scope: 'project' | 'global'): string => (scope === 'global' ? '全局' : '项目');
  /** scope 参数解析：缺省 null（走各工具默认路由/回落） */
  const parseScope = (v: unknown): 'project' | 'global' | null =>
    v === 'global' ? 'global' : v === 'project' ? 'project' : null;

  const handleListTools = async (args: Record<string, unknown>): Promise<MemoryToolOutput> => {
    if (!deps.isEnabled()) return notReady();
    const category = asString(args.category);
    const lines: string[] = [];
    for (const [name, spec] of Object.entries(INNER_TOOLS)) {
      if (category && spec.category !== category) continue;
      lines.push(`- ${name} [${spec.category}] ${spec.description} 参数：${spec.args}`);
    }
    if (lines.length === 0) return fail(`INVALID_PARAMS：未知类目 ${category}（read/write/maintain/search）`);
    return ok(`记忆工具（两仓：项目 + 全局；call_tool({name, args}) 执行）：\n${lines.join('\n')}`);
  };

  const handleCallTool = async (args: Record<string, unknown>): Promise<MemoryToolOutput> => {
    if (!deps.isEnabled()) return notReady();
    const name = asString(args.name);
    if (!name) return fail('INVALID_PARAMS：缺少 name（先用 list_tools 拿工具名）');
    const spec = INNER_TOOLS[name];
    if (!spec) return fail(`INVALID_PARAMS：未知工具 ${name}（先用 list_tools 查看）`);
    const inner = (args.args ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'memory_list': {
          const type = asString(inner.type);
          const filter = (rs: MemoryRecord[]): MemoryRecord[] =>
            type ? rs.filter((r) => r.frontmatter.type === type) : rs;
          const [project, global] = await Promise.all([
            projectStore().then((s) => s.list()),
            globalStore().then((s) => s.list()),
          ]);
          const p = filter(project);
          const g = filter(global);
          if (p.length === 0 && g.length === 0) return ok('记忆仓为空（项目仓与全局仓都没有条目）。');
          const fmt = (r: MemoryRecord, scope: 'project' | 'global'): string =>
            `- ${r.filename} [${r.frontmatter.type}]（${scopeLabel(scope)}仓）${r.frontmatter.title} — ${r.frontmatter.description}（更新于 ${r.frontmatter.updatedAt.slice(0, 10)}，${r.sizeBytes}B）`;
          return ok(
            `记忆共 ${p.length + g.length} 条（项目仓 ${p.length} / 全局仓 ${g.length}）：\n` +
              [...p.map((r) => fmt(r, 'project')), ...g.map((r) => fmt(r, 'global'))].join('\n'),
          );
        }
        case 'memory_read': {
          const filename = asString(inner.filename);
          if (!filename) return fail('INVALID_PARAMS：缺少 filename');
          const scope = parseScope(inner.scope);
          const readFrom = async (s: 'project' | 'global'): Promise<MemoryRecord> =>
            (s === 'global' ? await globalStore() : await projectStore()).read(filename);
          let r: MemoryRecord;
          let hitScope: 'project' | 'global';
          if (scope) {
            r = await readFrom(scope);
            hitScope = scope;
          } else {
            try {
              r = await readFrom('project');
              hitScope = 'project';
            } catch (err) {
              if (!isNotFound(err)) throw err;
              r = await readFrom('global'); // 项目仓未命中自动回落全局仓
              hitScope = 'global';
            }
          }
          return ok(
            `# ${r.frontmatter.title}（${r.filename}，${r.frontmatter.type}，${scopeLabel(hitScope)}仓，更新于 ${r.frontmatter.updatedAt}）\n\n${r.frontmatter.description}\n\n${r.body}`,
          );
        }
        case 'memory_search': {
          const query = asString(inner.query);
          if (!query) return fail('INVALID_PARAMS：缺少 query');
          const limit = typeof inner.limit === 'number' ? Math.min(Math.max(inner.limit, 1), 20) : 8;
          const [pHits, gHits] = await Promise.all([
            projectStore().then((s) => s.search(query, { limit })),
            globalStore().then((s) => s.search(query, { limit })),
          ]);
          const merged: Array<{ hit: SearchHit; scope: 'project' | 'global' }> = [
            ...pHits.map((hit) => ({ hit, scope: 'project' as const })),
            ...gHits.map((hit) => ({ hit, scope: 'global' as const })),
          ].slice(0, limit);
          if (merged.length === 0) return ok(`未命中「${query}」——记忆里没有相关内容，不要编造。`);
          const lines = merged.map(
            ({ hit: h, scope }, i) => `${i + 1}. [${scopeLabel(scope)}][${h.type}] ${h.title}（${h.filename}）\n   ${h.snippet}`,
          );
          return ok(`检索「${query}」命中 ${merged.length} 条：\n${lines.join('\n')}`);
        }
        case 'memory_write': {
          const type = asString(inner.type);
          const nm = asString(inner.name);
          const title = asString(inner.title);
          const description = asString(inner.description);
          const body = asString(inner.body);
          const mode = asString(inner.mode);
          if (!type || !nm || !title || !description || !body) {
            return fail('INVALID_PARAMS：type/name/title/description/body 均必填（mode 可选 create|update|append，scope 可选 project|global）');
          }
          // 缺省路由：user/feedback → 全局仓（跨项目共享），其余 → 项目仓
          const scope = parseScope(inner.scope) ?? (MEMORY_GLOBAL_TYPES.has(type) ? 'global' : 'project');
          const store = scope === 'global' ? await globalStore() : await projectStore();
          const result = await store.write({
            type: type as MemoryType,
            name: nm,
            title,
            description,
            body,
            ...(mode === 'update' || mode === 'append' ? { mode } : {}),
          });
          return ok(
            `已保存 ${result.filename}（${scopeLabel(scope)}仓）。` +
              (result.warning ? ` 软警告 ${result.warning}（写入成功，但建议瘦身或 consolidate）` : ''),
          );
        }
        case 'memory_delete': {
          const filename = asString(inner.filename);
          if (!filename) return fail('INVALID_PARAMS：缺少 filename');
          const scope = parseScope(inner.scope);
          if (scope === 'global') {
            await (await globalStore()).delete(filename);
            return ok(`已删除 ${filename}（全局仓）。`);
          }
          try {
            await (await projectStore()).delete(filename);
            return ok(`已删除 ${filename}（项目仓）。`);
          } catch (err) {
            if (scope || !isNotFound(err)) throw err;
            // 项目仓没有但全局仓有 → 要求显式确认删全局（防误删共享记忆）
            try {
              await (await globalStore()).read(filename);
            } catch {
              throw err;
            }
            return fail(
              `NOT_FOUND_IN_PROJECT：项目仓没有 ${filename}，但它存在于全局仓（所有会话共享）。确认要删全局条目请重新调用并传 scope:"global"。`,
            );
          }
        }
        case 'memory_consolidate': {
          const sources = Array.isArray(inner.sources)
            ? inner.sources.filter((s): s is string => typeof s === 'string' && s.length > 0)
            : [];
          const target = (inner.target ?? {}) as Record<string, unknown>;
          if (sources.length < 2) return fail('INVALID_PARAMS：sources 至少 2 条');
          const tType = asString(target.type);
          const tName = asString(target.name);
          const tTitle = asString(target.title);
          const tDesc = asString(target.description);
          const tBody = asString(target.body);
          if (!tType || !tName || !tTitle || !tDesc || !tBody) {
            return fail('INVALID_PARAMS：target 需含 type/name/title/description/body');
          }
          const scope = parseScope(inner.scope) ?? 'project';
          const store = scope === 'global' ? await globalStore() : await projectStore();
          const result = await store.consolidate({
            sources,
            target: { type: tType as MemoryType, name: tName, title: tTitle, description: tDesc, body: tBody },
          });
          return ok(
            `已合并为 ${result.filename}（${scopeLabel(scope)}仓），删除源 ${result.deletedSources.length} 条。` +
              (result.warning ? ` 软警告 ${result.warning}` : ''),
          );
        }
        default:
          return fail(`INVALID_PARAMS：未知工具 ${name}`);
      }
    } catch (err) {
      return fail(errMessage(err));
    }
  };

  return { listTools: handleListTools, callTool: handleCallTool };
}
