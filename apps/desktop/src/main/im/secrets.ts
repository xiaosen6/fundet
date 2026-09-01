import type { ImChannelId } from '../../shared/im-bots.ts';
import { deleteProviderKey, readProviderKey, writeProviderKey } from '../host/secrets.js';

function secretId(id: ImChannelId): string {
  return `im-${id}`;
}

export function readImCreds(id: ImChannelId): Record<string, string> | null {
  const raw = readProviderKey(secretId(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

export function writeImCreds(id: ImChannelId, fields: Record<string, string>): void {
  writeProviderKey(secretId(id), JSON.stringify(fields));
}

export function clearImCreds(id: ImChannelId): void {
  deleteProviderKey(secretId(id));
}

export function hasImCreds(id: ImChannelId): boolean {
  return readImCreds(id) !== null;
}
