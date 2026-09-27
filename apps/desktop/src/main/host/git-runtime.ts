/**
 * 随包运行时 tar.gz 首启解压执行体（安装提速，0.3.14）。
 *
 * 安装慢实测根因 = 每文件固定开销（写盘 + 杀软逐文件扫描）。git（2,518 文件）
 * 改单文件 tar.gz 随包、首启解到 userData/runtime/git。浏览器依赖 tar.gz 方案
 * 曾在 0.3.14 发布并致启动崩溃（ESM 静态 import 抢在解压前解析）——已回滚为
 * 散装 node_modules 目录，勿再尝试（要恢复须先把 SDK import 改为启动后动态加载）。
 * 决策纯函数在 git-runtime-logic.ts（单测在 git-runtime-logic.test.ts）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { decideGitRuntimeExtract } from './git-runtime-logic.js';

export { decideGitRuntimeExtract } from './git-runtime-logic.js';

function tarBinPath(): string {
  return fs.existsSync('C:/Windows/System32/tar.exe') ? 'C:/Windows/System32/tar.exe' : 'tar';
}

/** 通用解压：tgz → targetDir（幂等判定由调用方给参）；成功 true */
function extractTgz(tgz: string, targetDir: string): boolean {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  const r = spawnSync(tarBinPath(), ['-xzf', tgz.replace(/\\/g, '/'), '-C', targetDir.replace(/\\/g, '/')], {
    stdio: 'ignore',
    timeout: 120_000,
    windowsHide: true,
  });
  return r.status === 0;
}

/**
 * 打包版首启把 resources/runtime/git.tar.gz 解到 userData/runtime/git
 * （Windows 自带 bsdtar；60s 上限）。失败静默——git 回退退化为「无随包」
 * 状态（系统装了 Git 的用户不受任何影响）。dev 态无需（直接用仓库目录）。
 */
export function ensureBundledGitRuntime(): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const tgz = path.join(process.resourcesPath, 'runtime', 'git.tar.gz');
  const targetDir = path.join(app.getPath('userData'), 'runtime', 'git');
  const marker = path.join(targetDir, 'VERSION');
  let version: string | null = null;
  try {
    version = fs.readFileSync(path.join(process.resourcesPath, 'runtime', 'git.version'), 'utf8').trim() || null;
  } catch {
    version = 'unknown'; // 版本文件缺失 → 每次启动重解（保底可用，非最优）
  }
  if (
    !decideGitRuntimeExtract(
      { exists: fs.existsSync, read: (p) => fs.readFileSync(p, 'utf8') },
      { bundledTgz: tgz, targetDir, extractedMarker: marker, bundledVersion: version },
    )
  ) {
    return;
  }
  if (!extractTgz(tgz, targetDir) || !fs.existsSync(path.join(targetDir, 'bin', 'bash.exe'))) {
    console.warn('[fundet:git-bash] 随包 git 解压失败，回退本次不可用（系统装了 Git 的用户不受影响）');
    return;
  }
  if (version && version !== 'unknown') fs.writeFileSync(marker, version + '\n');
  console.log('[fundet:git-bash] 随包 git 运行时就绪', version ?? '');
}
