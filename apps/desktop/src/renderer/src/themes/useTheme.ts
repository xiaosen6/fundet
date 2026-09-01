/**
 * useTheme — light / dark / system 三态主题。
 *
 * 实现：模块级微型 store（useSyncExternalStore），把解析后的主题写到
 * <html data-theme="…">，globals.css 里的 token 随之切换。选择持久化到 localStorage。
 */
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'fundet.theme';

let mode: ThemeMode = readStoredMode();
const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readStoredMode(): ThemeMode {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

function resolve(): ResolvedTheme {
  if (mode === 'system') return media.matches ? 'dark' : 'light';
  return mode;
}

function apply(): void {
  document.documentElement.dataset.theme = resolve();
}

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  window.localStorage.setItem(STORAGE_KEY, next);
  apply();
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// system 档跟随 OS：media 变化时重新应用并通知
media.addEventListener('change', () => {
  if (mode !== 'system') return;
  apply();
  for (const l of listeners) l();
});

// 模块加载即应用一次，避免首屏闪错主题
apply();

export function useTheme(): { mode: ThemeMode; resolved: ResolvedTheme; setMode: (m: ThemeMode) => void } {
  const current = useSyncExternalStore(subscribe, () => mode);
  return { mode: current, resolved: resolve(), setMode: setThemeMode };
}
