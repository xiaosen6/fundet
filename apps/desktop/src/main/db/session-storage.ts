/**
 * SessionStorage（agent-core 接口）的 drizzle 实现，基于 sessions 表。
 *
 * SessionMeta 里 DB 没有的字段（workspaceKind/fastMode/reviewMode/remoteHostId）
 * 本阶段不落库：create 时忽略、读出为 undefined。
 */
import { eq, desc } from 'drizzle-orm';
import type { SessionMeta, SessionStorage } from '@fundet/agent-core';
import type { Effort, PermissionMode } from '@fundet/agent-core';
import { getDb } from './client.js';
import { sessions } from './schema.js';

function rowToMeta(row: typeof sessions.$inferSelect): SessionMeta {
  return {
    id: row.id,
    agentKind: 'pi',
    workDir: row.workDir,
    title: row.title,
    model: row.model,
    effort: (row.effort ?? undefined) as Effort | undefined,
    permissionMode: (row.permissionMode ?? undefined) as PermissionMode | undefined,
    sdkSessionId: row.sdkSessionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSessionStorage(): SessionStorage {
  return {
    async create(meta) {
      const now = Date.now();
      getDb()
        .insert(sessions)
        .values({
          id: meta.id,
          agentKind: meta.agentKind,
          title: meta.title,
          workDir: meta.workDir,
          model: meta.model,
          effort: meta.effort ?? null,
          permissionMode: meta.permissionMode ?? null,
          sdkSessionId: meta.sdkSessionId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { ...meta, createdAt: now, updatedAt: now };
    },

    async get(id) {
      const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get();
      return row ? rowToMeta(row) : null;
    },

    async list() {
      const rows = getDb().select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
      return rows.map(rowToMeta);
    },

    async update(id, patch) {
      const sets: Partial<typeof sessions.$inferInsert> = { updatedAt: Date.now() };
      if (patch.title !== undefined) sets.title = patch.title;
      if (patch.model !== undefined) sets.model = patch.model;
      if (patch.workDir !== undefined) sets.workDir = patch.workDir;
      if (patch.effort !== undefined) sets.effort = patch.effort ?? null;
      if (patch.permissionMode !== undefined) sets.permissionMode = patch.permissionMode ?? null;
      if (patch.sdkSessionId !== undefined) sets.sdkSessionId = patch.sdkSessionId ?? null;
      getDb().update(sessions).set(sets).where(eq(sessions.id, id)).run();
      const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get();
      if (!row) throw new Error(`session not found: ${id}`);
      return rowToMeta(row);
    },

    async compareAndClearSdkSessionId(id, expectedSdkSessionId) {
      const db = getDb();
      const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
      if (!row || row.sdkSessionId !== expectedSdkSessionId) return false;
      db.update(sessions)
        .set({ sdkSessionId: null, updatedAt: Date.now() })
        .where(eq(sessions.id, id))
        .run();
      return true;
    },

    async delete(id) {
      getDb().delete(sessions).where(eq(sessions.id, id)).run();
    },
  };
}
