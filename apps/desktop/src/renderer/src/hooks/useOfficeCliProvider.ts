/**
 * 当前办公 CLI 供应商（企业微信 / 钉钉）的渲染层缓存。真源在主进程 settings；
 * ChatPage 挂载时经 dwsStatus() 取一次并订阅切换推送，其余组件（知识库 chip 等）
 * 经这个 hook 读取，不必各自发 IPC。
 *
 * 缺省值是模块级常量——useSyncExternalStore 的 getSnapshot 必须引用稳定
 * （见 referenceStability.test.ts：空集合/新对象 = 永变 = 无限重渲染）。
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_OFFICE_PROVIDER, type OfficeCliProvider } from '../../../shared/office-cli.ts';

let cached: OfficeCliProvider = DEFAULT_OFFICE_PROVIDER;
const listeners = new Set<() => void>();

export function setOfficeCliProviderCache(provider: OfficeCliProvider): void {
  if (provider === cached) return;
  cached = provider;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OfficeCliProvider {
  return cached;
}

export function useOfficeCliProvider(): OfficeCliProvider {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
