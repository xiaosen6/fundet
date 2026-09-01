import {
  SEARCH_ENGINES,
  isSearchEngineId,
  type SearchEngineId,
} from '../../shared/search-engines.ts';
import { getSetting, setSetting } from '../db/settings.js';
import { deleteProviderKey, hasProviderKey, readProviderKey, writeProviderKey } from '../host/secrets.js';

const DEFAULT_KEY = 'search.defaultEngine';

export function searchSecretId(id: SearchEngineId): string {
  return SEARCH_ENGINES.find((e) => e.id === id)!.secretId;
}

export function hasSearchKey(id: SearchEngineId): boolean {
  return hasProviderKey(searchSecretId(id));
}

export function readSearchKey(id: SearchEngineId): string | null {
  return readProviderKey(searchSecretId(id));
}

export function writeSearchKey(id: SearchEngineId, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('API key 不能为空');
  writeProviderKey(searchSecretId(id), trimmed);
}

export function clearSearchKey(id: SearchEngineId): void {
  deleteProviderKey(searchSecretId(id));
}

export function configuredSearchEngines(): SearchEngineId[] {
  return SEARCH_ENGINES.map((e) => e.id).filter(hasSearchKey);
}

export function getDefaultSearchEngine(): SearchEngineId | null {
  const raw = getSetting(DEFAULT_KEY);
  if (isSearchEngineId(raw) && hasSearchKey(raw)) return raw;
  return configuredSearchEngines()[0] ?? null;
}

export function setDefaultSearchEngine(id: SearchEngineId | null): void {
  if (id === null) {
    setSetting(DEFAULT_KEY, '');
    return;
  }
  setSetting(DEFAULT_KEY, id);
}

export function resolveSearchEngine(requested?: string | null): SearchEngineId | null {
  if (isSearchEngineId(requested) && hasSearchKey(requested)) return requested;
  return getDefaultSearchEngine();
}
