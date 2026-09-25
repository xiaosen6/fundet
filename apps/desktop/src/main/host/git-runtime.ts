/**
 * 随包 git 运行时：tar.gz 首启解压执行体（安装提速，0.3.14）。
 *
 * 安装慢实测根因 = 每文件固定开销（写盘 + 杀软逐文件扫描）：git 目录 2,518
 * 个文件贡献大半。改为单文件 tar.gz 随包（NSIS 内 ~85MB），安装期只写 1 个
 * 文件；首次启动在 Splash 遮面下解到 userData/runtime/git（幂等按版本标记），
 * PATH 回退照旧指向该目录。决策纯函数在 git-runtime-logic.ts（单测在
 * git-runtime-logic.test.ts）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { decideGitRuntimeExtract } from './git-runtime-logic.js';

export { decideGitRuntimeExtract } from './git-runtime-logic.js';

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
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  const tarBin = fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  const r = spawnSync(tarBin, ['-xzf', tgz, '-C', targetDir], {
    stdio: 'ignore',
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.status !== 0 || !fs.existsSync(path.join(targetDir, 'bin', 'bash.exe'))) {
    console.warn('[fundet:git-bash] 随包 git 解压失败，回退本次不可用（系统装了 Git 的用户不受影响）');
    return;
  }
  if (version && version !== 'unknown') fs.writeFileSync(marker, version + '\n');
  console.log('[fundet:git-bash] 随包 git 运行时就绪', version ?? '');
}
