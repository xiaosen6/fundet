/**
 * 记忆面板服务层：scope 扫描（磁盘 maker-memory/* + meta.json）+ 开关读写。
 * store 读写经 manager（与 MCP 工具同一 store 实例池，FTS 同步一致）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { MakerMemoryManager, MemoryRecord, MemoryType, SearchHit } from '@fundet/agent-core';
import { getBoolSetting, setBoolSetting } from '../db/settings.js';
import { MEMORY_ENABLED_SETTING, type MemoryRecordView, type MemoryScopeView } from '../../shared/memory.ts';

/** userData/maker-memory 根目录（与 manager 的 MEMORY_SUBDIR 约定一致） */
export function memoryRoot(): string {
  return path.join(app.getPath('userData'), 'maker-memory');
}

/** 扫描磁盘列出全部记忆仓（scope 目录 + meta.json 里的工作目录 + 条数） */
export function listMemoryScopes(): MemoryScopeView[] {
  const root = memoryRoot();
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const scopes: MemoryScopeView[] = [];
  for (const name of entries) {
    const scopeDir = path.join(root, name);
    let absWorkdir = scopeDir;
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
