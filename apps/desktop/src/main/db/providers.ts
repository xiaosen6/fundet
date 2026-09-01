/**
 * providers 表读写（BYOK 配置）。API key 不在这里 —— 走 host/secrets.ts 的 safeStorage。
 */
import { randomUUID } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { getDb } from './client.js';
import { providers, type ProviderModelSpec, type ProviderRow } from './schema.js';
import { preferScannedContextWindow } from '../../shared/context-window.js';

export interface ProviderView {
  id: string;
  name: string;
  api: ProviderRow['api'];
  baseUrl: string;
  models: ProviderModelSpec[];
  createdAt: number;
}

export interface ProviderInput {
  name: string;
  api: ProviderRow['api'];
  baseUrl: string;
  models: ProviderModelSpec[];
}

function hydrateModels(models: ProviderModelSpec[]): ProviderModelSpec[] {
  return models.map((m) => {
    const contextWindow = preferScannedContextWindow(m.id, m.contextWindow);
    return contextWindow ? { ...m, contextWindow } : m;
  });
}

function toView(row: ProviderRow): ProviderView {
  let models: ProviderModelSpec[] = [];
  try {
    models = JSON.parse(row.models) as ProviderModelSpec[];
  } catch {
    // 脏数据兜底为空数组，不让单条坏行拖垮整个列表
  }
  return {
    id: row.id,
    name: row.name,
    api: row.api,
    baseUrl: row.baseUrl,
    models: hydrateModels(models),
    createdAt: row.createdAt,
  };
}

export function listProviders(): ProviderView[] {
  return getDb().select().from(providers).orderBy(asc(providers.createdAt)).all().map(toView);
}

export function getProvider(id: string): ProviderView | null {
  const row = getDb().select().from(providers).where(eq(providers.id, id)).get();
  return row ? toView(row) : null;
}

export function createProvider(input: ProviderInput): ProviderView {
  const row = {
    id: randomUUID(),
    name: input.name,
    api: input.api,
    baseUrl: input.baseUrl,
    models: JSON.stringify(input.models),
    createdAt: Date.now(),
  };
  getDb().insert(providers).values(row).run();
  return toView(row);
}

export function updateProvider(id: string, patch: Partial<ProviderInput>): ProviderView {
  const sets: Partial<typeof providers.$inferInsert> = {};
  if (patch.name !== undefined) sets.name = patch.name;
  if (patch.api !== undefined) sets.api = patch.api;
  if (patch.baseUrl !== undefined) sets.baseUrl = patch.baseUrl;
  if (patch.models !== undefined) sets.models = JSON.stringify(patch.models);
  getDb().update(providers).set(sets).where(eq(providers.id, id)).run();
  const view = getProvider(id);
  if (!view) throw new Error(`provider not found: ${id}`);
  return view;
}

export function deleteProvider(id: string): void {
  getDb().delete(providers).where(eq(providers.id, id)).run();
}
