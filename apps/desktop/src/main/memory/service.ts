/**
 * 记忆面板服务层：scope 扫描（磁盘 maker-memory/* + meta.json）+ 开关读写。
 * store 读写经 manager（与 MCP 工具同一 store 实例池，FTS 同步一致）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { memoryScopeDirName } from '@fundet/agent-core';
import type { MakerMemoryManager, MemoryRecord, MemoryType, SearchHit } from '@fundet/agent-core';
import { getBoolSetting, setBoolSetting } from '../db/settings.js';
import { MEMORY_ENABLED_SETTING, type MemoryRecordView, type MemoryScopeView } from '../../shared/memory.ts';

/** userData/maker-memory 根目录（与 manager 的 MEMORY_SUBDIR 约定一致） */
export function memoryRoot(): string {
  return path.join(app.getPath('userData'), 'maker-memory');
}

/** 主目录仓（默认仓）：桌面未选目录的会话与 IM 会话共用的记忆作用域 */
export function defaultMemoryScope(): { absWorkdir: string; scopeDir: string } {
  const absWorkdir = os.homedir();
  return { absWorkdir, scopeDir: path.join(memoryRoot(), memoryScopeDirName(absWorkdir)) };
}

/** 确保记忆仓目录存在（打开文件夹/空仓新建前用——没存过第一条记忆时目录尚不存在） */
export function ensureMemoryScopeDir(absWorkdir: string): string {
  const dir = path.join(memoryRoot(), memoryScopeDirName(absWorkdir));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 扫描磁盘列出全部记忆仓（scope 目录 + meta.json 里的工作目录 + 条数）。
 *  主目录仓永远在列（空仓也显示——否则新建按钮无仓可用，鸡生蛋）。 */
export function listMemoryScopes(): MemoryScopeView[] {
  const root = memoryRoot();
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    /* 根目录还不存在（没存过记忆）→ 只有默认仓 */
  }
  const scopes: MemoryScopeView[] = [];
  const def = defaultMemoryScope();
  const defDirName = path.basename(def.scopeDir);
  for (const name of entries) {
    const scopeDir = path.join(root, name);
    let absWorkdir = def.absWorkdir;
    let updatedAt: string | null = null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(scopeDir, 'meta.json'), 'utf8')) as {
        absPath?: string;
        lastUsedAt?: string;
      };
      if (typeof meta.absPath === 'string' && meta.absPath) absWorkdir = meta.absPath;
      if (typeof meta.lastUsedAt === 'string') updatedAt = meta.lastUsedAt;
    } catch {
      /* 无 meta（手建目录等）→ 用目录名兜底 */
    }
    let recordCount = 0;
    try {
      recordCount = fs
        .readdirSync(scopeDir)
        .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
    } catch {
      /* ignore */
    }
    scopes.push({ absWorkdir, scopeDir, recordCount, updatedAt });
  }
  if (!entries.includes(defDirName)) {
    scopes.push({ absWorkdir: def.absWorkdir, scopeDir: def.scopeDir, recordCount: 0, updatedAt: null });
  }
  return scopes.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function toRecordView(r: MemoryRecord): MemoryRecordView {
  return {
    filename: r.filename,
    type: r.frontmatter.type,
    title: r.frontmatter.title,
    description: r.frontmatter.description,
    updatedAt: r.frontmatter.updatedAt,
    body: r.body,
    sizeBytes: r.sizeBytes,
  };
}

export interface MemorySaveInput {
  type: string;
  name: string;
  title: string;
  description: string;
  body: string;
  mode?: 'create' | 'update' | 'append';
}

/** 面板 CRUD 的统一门面（register.ts 调用；store 经 manager 实例池） */
export function createMemoryPanelService(manager: MakerMemoryManager) {
  return {
    scopes: listMemoryScopes,
    list: async (absWorkdir: string): Promise<MemoryRecordView[]> =>
      (await manager.getStore(absWorkdir)).list().then((rs) => rs.map(toRecordView)),
    get: async (absWorkdir: string, filename: string): Promise<MemoryRecordView> =>
      toRecordView(await (await manager.getStore(absWorkdir)).read(filename)),
    save: async (absWorkdir: string, input: MemorySaveInput): Promise<string> => {
      const result = await (await manager.getStore(absWorkdir)).write({
        type: input.type as MemoryType,
        name: input.name,
        title: input.title,
        description: input.description,
        body: input.body,
        ...(input.mode ? { mode: input.mode } : {}),
      });
      return result.filename;
    },
    remove: async (absWorkdir: string, filename: string): Promise<void> => {
      await (await manager.getStore(absWorkdir)).delete(filename);
    },
    search: async (absWorkdir: string, query: string): Promise<SearchHit[]> =>
      (await manager.getStore(absWorkdir)).search(query, { limit: 20 }),
    enabled: (): boolean => manager.isEnabled() && getBoolSetting(MEMORY_ENABLED_SETTING, true),
    setEnabled: async (next: boolean): Promise<void> => {
      setBoolSetting(MEMORY_ENABLED_SETTING, next);
      if (next) {
        await manager.enable({ skipAgentSync: true });
      } else {
        await manager.disable();
      }
    },
  };
}

export type MemoryPanelService = ReturnType<typeof createMemoryPanelService>;
