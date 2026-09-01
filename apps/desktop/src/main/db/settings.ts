/**
 * settings 表读写：main 进程侧需要的简单开关持久化（key-value，值为字符串）。
 * renderer-only 的设置（主题、默认工作目录）不走这里，仍走 localStorage。
 */
import { eq } from 'drizzle-orm';
import { getDb } from './client.js';
import { settings } from './schema.js';

export function getSetting(key: string): string | null {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    getDb().delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/** 布尔设置的便捷封装：缺省返回 defaultValue */
export function getBoolSetting(key: string, defaultValue: boolean): boolean {
  const raw = getSetting(key);
  if (raw === null) return defaultValue;
  return raw === '1';
}

export function setBoolSetting(key: string, value: boolean): void {
  setSetting(key, value ? '1' : '0');
}
