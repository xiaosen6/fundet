/**
 * 新会话默认值（localStorage）：默认工作目录 + 上次使用的 provider/model。
 * 工作目录没有 IPC 可问 main 要「用户 home」，因此由设置页显式配置。
 */

const KEY_WORK_DIR = 'fundet.defaultWorkDir';
const KEY_PROVIDER = 'fundet.lastProviderId';
const KEY_MODEL = 'fundet.lastModel';

export function getDefaultWorkDir(): string {
  return window.localStorage.getItem(KEY_WORK_DIR) ?? '';
}

export function setDefaultWorkDir(dir: string): void {
  window.localStorage.setItem(KEY_WORK_DIR, dir);
}

export function getLastProviderId(): string {
  return window.localStorage.getItem(KEY_PROVIDER) ?? '';
}

export function getLastModel(): string {
  return window.localStorage.getItem(KEY_MODEL) ?? '';
}

export function rememberModelChoice(providerId: string, model: string): void {
  window.localStorage.setItem(KEY_PROVIDER, providerId);
  window.localStorage.setItem(KEY_MODEL, model);
}
