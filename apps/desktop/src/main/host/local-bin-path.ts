/**
 * ~/.local/bin 在不在 PATH 上。办公 CLI（dws / wecom-cli）的安装位置就在这里，
 * Agent 的 bash 靠 PATH 找裸命令名——不在 PATH 上时速查表里的命令全部
 * 「command not found」。缺了就**追加到末尾**（不前置：不改变已有命令的解析
 * 优先级），pi 子进程经 spawnEnv（拷贝 process.env）继承。
 * 只改本进程环境，不写注册表（官方 dws 安装脚本会写用户 PATH，这里不重复）。
 */
import os from 'node:os';
import path from 'node:path';

function joinFor(platform: NodeJS.Platform, ...segments: string[]): string {
  return (platform === 'win32' ? path.win32 : path.posix).join(...segments);
}

/** 纯函数：PATH 值里没有该目录时追加到末尾（幂等；Windows 分隔符与大小写不敏感） */
export function withPathEntry(
  currentPath: string | undefined,
  entry: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const sep = platform === 'win32' ? ';' : ':';
  const normalize = (p: string): string =>
    platform === 'win32'
      ? p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
      : p.replace(/\/+$/, '');
  const target = normalize(entry);
  if ((currentPath ?? '').split(sep).some((p) => normalize(p) === target)) {
    return currentPath ?? '';
  }
  return currentPath ? `${currentPath}${sep}${entry}` : entry;
}

/** 应用到进程环境；返回是否改动。deps 可注入以便测试。 */
export function ensureUserLocalBinOnPath(
  deps: { home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): boolean {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const entry = joinFor(platform, deps.home ?? os.homedir(), '.local', 'bin');
  const current = env.PATH ?? env.Path;
  const next = withPathEntry(current, entry, platform);
  if (next === (current ?? '')) return false;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env.PATH = next;
  return true;
}
