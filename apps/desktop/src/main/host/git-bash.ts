/**
 * 随包 Git Bash 回退（Windows）。
 *
 * 客户机没装 Git for Windows 时：pi 的 bash 工具只认 bash.exe（找不到直接报
 * 「No bash shell found」），checkpoint 快照/回滚用 PATH 上的 git 也整体关闭。
 * 0.3.11 起安装包内置裁剪版便携 Git Bash（extraResources git/win32-x64，
 * apps/git-bin 由 tools/git/update.mjs 准备）。
 *
 * 激活条件（fail-safe，宁可不激活也不抢用户自己的 Git）：
 *   win32 且随包目录在场（bin/bash.exe 存在）
 *   且系统 Git 完全不可见——注册表/常见安装位（agent-core
 *   resolveWindowsGitPathEntries）找不到，PATH 上也探测不到 git。
 * 满足时把 <root>/cmd 与 <root>/bin 前置进主进程 PATH：pi 子进程经
 * spawnEnv（拷贝 process.env）继承，PATH 搜索即命中 bin/bash.exe；
 * checkpoint 的 git 同链路复活。用户装了自己的 Git（含不在 PATH 的）时
 * 本模块不动作，行为与旧版一致。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 纯函数：由各项探测结果算出应前置的 PATH 目录（空数组 = 不动作） */
export function computeGitFallbackEntries(input: {
  platform: NodeJS.Platform;
  bundledRoot: string | null;
  systemGitPathEntries: readonly string[];
  gitReachableOnPath: boolean;
  currentPath: string | undefined;
  exists?: (p: string) => boolean;
}): string[] {
  const { platform, bundledRoot, systemGitPathEntries, gitReachableOnPath, currentPath } = input;
  if (platform !== 'win32') return [];
  if (!bundledRoot) return [];
  if (systemGitPathEntries.length > 0 || gitReachableOnPath) return [];
  const exists = input.exists ?? fs.existsSync;
  const entries: string[] = [];
  for (const sub of ['cmd', 'bin'] as const) {
    const dir = path.join(bundledRoot, sub);
    if (exists(path.join(dir, 'bash.exe')) || exists(path.join(dir, 'git.exe'))) {
      entries.push(dir);
    }
  }
  if (entries.length === 0) return [];
  const current = (currentPath ?? '').toLowerCase().split(';').filter(Boolean);
  return entries.filter((e) => !current.includes(e.toLowerCase()));
}

/** 纯函数：把条目前置进 PATH 值（幂等，已存在不重复加） */
export function prependPathEntries(currentPath: string | undefined, entries: readonly string[]): string {
  if (entries.length === 0) return currentPath ?? '';
  return `${entries.join(';')};${currentPath ?? ''}`;
}

/** 探测 PATH 上是否有可用 git（spawn 失败视为没有；结果调用方缓存） */
export function gitReachableOnPath(): boolean {
  try {
    execFileSync('git', ['--version'], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 应用回退（改 process.env.PATH）。在 bootstrap 早期调用一次——必须早于首个
 * pi 会话与首次快照。deps 可注入以便测试。
 *
 * FUNDET_FORCE_BUNDLED_GIT=1：无视系统 Git 强制启用随包版——仅供开发机实测
 * （开发者机器都装了 Git，正常门控永远不触发）。
 */
export function setupBundledGitFallback(deps: {
  platform?: NodeJS.Platform;
  bundledRoot: string | null;
  systemGitPathEntries: readonly string[];
  gitReachable?: boolean;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
}): string[] {
  const env = deps.env ?? process.env;
  const force = env.FUNDET_FORCE_BUNDLED_GIT === '1';
  const entries = computeGitFallbackEntries({
    platform: deps.platform ?? process.platform,
    bundledRoot: deps.bundledRoot,
    systemGitPathEntries: force ? [] : deps.systemGitPathEntries,
    gitReachableOnPath: force ? false : (deps.gitReachable ?? gitReachableOnPath()),
    currentPath: env.PATH ?? env.Path,
    exists: deps.exists,
  });
  if (entries.length === 0) return [];
  const current = env.PATH ?? env.Path;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env.PATH = prependPathEntries(current, entries);
  return entries;
}
