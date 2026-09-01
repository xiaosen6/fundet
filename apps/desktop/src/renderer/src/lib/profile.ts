import { brand } from '../../../shared/brand.js';
const KEY = 'longma.profile';

export interface LocalProfile {
  name: string;
  avatar: string | null;
}

const DEFAULT: LocalProfile = { name: brand.name, avatar: null };
const listeners = new Set<() => void>();

function read(): LocalProfile {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<LocalProfile>;
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : DEFAULT.name,
      avatar: typeof parsed.avatar === 'string' && parsed.avatar.startsWith('data:') ? parsed.avatar : null,
    };
  } catch {
    return DEFAULT;
  }
}

let current = read();

export function getProfile(): LocalProfile {
  return current;
}

export function setProfile(patch: Partial<LocalProfile>): void {
  current = {
    name: patch.name !== undefined ? (patch.name.trim() || DEFAULT.name) : current.name,
    avatar: patch.avatar !== undefined ? patch.avatar : current.avatar,
  };
  window.localStorage.setItem(KEY, JSON.stringify(current));
  for (const l of listeners) l();
}

export function subscribeProfile(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
