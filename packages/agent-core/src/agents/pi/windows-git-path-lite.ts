/**
 * Windows Git Bash PATH 增强（Cindy windows-git-path 模块的轻量移植）。
 *
 * pi 的 bash 工具只认 PATH 上的 bash.exe（Git Bash）。客户机装了 Git 但
 * 「Add to PATH」没勾时 bash 工具就废。这里在 spawn pi 前把常见 Git 安装
 * 位置前置进 PATH：注册表 GitForWindows.InstallPath（reg query，毫秒级）
 * + 标准安装路径。结果进程内缓存。
 *
 * Cindy 的完整模块（网络驱动器/并发探测/进程清理，900 行）在主线也尚未
 * 接线；此轻量版覆盖核心场景，完整版待有真实报障再移植。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedEntries: string[] | null = null;

/** 纯函数：候选安装根 → PATH 目录（cmd 在前，bin 次之），目录须真实存在 */
export function gitPathEntriesFromRoots(
  roots: readonly string[],
  exists: (p: string) => boolean = fs.existsSync,
): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    for (const sub of ['cmd', 'bin']) {
      const dir = path.join(root, sub);
      if (exists(path.join(dir, 'bash.exe')) && !out.includes(dir)) out.push(dir);
    }
  }
  return out;
}

/** 注册表读 GitForWindows.InstallPath（HKCU 优先，失败静默返回 null） */
function gitInstallPathFromRegistry(): string | null {
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync(
        'reg',
        [
          'query',
          `${hive}\\SOFTWARE\\GitForWindows`,
          '/v',
          'InstallPath',
        ],
        { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const m = /InstallPath\s+REG_SZ\s+(\S.*\S)\s*$/m.exec(out);
      if (m?.[1]) return m[1].trim();
    } catch {
      /* 键不存在或 reg 不可用 */
    }
  }
  return null;
}

/** 常见安装位置（含 per-user 安装） */
function commonGitRoots(): string[] {
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(
    (v): v is string => Boolean(v),
  );
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return [
    ...pf.map((p) => path.join(p, 'Git')),
    path.join(localAppData, 'Programs', 'Git'),
  ];
}

export function resolveWindowsGitPathEntries(): string[] {
  if (cachedEntries !== null) return cachedEntries;
  if (process.platform !== 'win32') {
    cachedEntries = [];
    return cachedEntries;
  }
  const roots = [gitInstallPathFromRegistry(), ...commonGitRoots()].filter((r): r is string => r !== null);
  cachedEntries = gitPathEntriesFromRoots(roots);
  return cachedEntries;
}

/** 把 Git 目录前置进 env.PATH（win32 之外原样返回） */
export function augmentPathWithGit(env: Record<string, string | undefined>): void {
  if (process.platform !== 'win32') return;
  const entries = resolveWindowsGitPathEntries();
  if (entries.length === 0) return;
  const current = env['PATH'] ?? env['Path'] ?? process.env['PATH'] ?? '';
  const prefix = entries.filter((e) => !current.toLowerCase().split(';').includes(e.toLowerCase()));
  if (prefix.length === 0) return;
  const merged = `${prefix.join(';')};${current}`;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env['PATH'] = merged;
}
