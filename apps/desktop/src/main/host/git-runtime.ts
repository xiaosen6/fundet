/**
 * 随包运行时 tar.gz 首启解压执行体（安装提速，0.3.14）。
 *
 * 安装慢实测根因 = 每文件固定开销（写盘 + 杀软逐文件扫描）。两个大件改单文件
 * tar.gz 随包、首启解压：git（2,518 文件）解到 userData/runtime/git（无解析
 * 依赖，PATH 指过去即可）；浏览器运行时依赖（~5,000 文件）解回**安装目录**
 * resources/node_modules——主 bundle 是 ESM，裸引用 @fundet/browser-runtime
 * 与 MCP SDK 靠 node_modules 向上解析命中，globalPaths/NODE_PATH 对 ESM 无效，
 * 只能落回原位（每用户安装目录可写；无写权限时降级并提示重装到默认目录）。
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

/**
 * 打包版首启把 resources/runtime/browser.tar.gz 解回安装目录 resources/
 * node_modules（ESM 向上解析依赖此位置）。幂等标记 = node_modules/
 * .fundet-runtime-version 对齐随包版本；自动更新换包后标记失配自动重解。
 * 无写权限（用户自选了受保护安装目录）→ 警告 + 浏览器自动化不可用，其余功能不受影响。
 */
export function ensureBrowserRuntimeExtracted(): void {
  if (!app.isPackaged) return;
  const runtimeDir = path.join(process.resourcesPath, 'runtime');
  const tgz = path.join(runtimeDir, 'browser.tar.gz');
  if (!fs.existsSync(tgz)) return;
  let version = 'unknown';
  try {
    version = fs.readFileSync(path.join(runtimeDir, 'browser.version'), 'utf8').trim() || 'unknown';
  } catch {
    /* 保底每次重解 */
  }
  const targetDir = path.join(process.resourcesPath, 'node_modules');
  const marker = path.join(targetDir, '.fundet-runtime-version');
  const ok = () =>
    fs.existsSync(marker) &&
    fs.readFileSync(marker, 'utf8').trim() === version &&
    fs.existsSync(path.join(targetDir, '@fundet', 'browser-runtime', 'dist'));
  if (ok()) return;
  try {
    if (!extractTgz(tgz, targetDir)) throw new Error('tar exit != 0');
    fs.writeFileSync(marker, version + '\n');
    console.log('[fundet:browser] 运行时依赖就绪（node_modules 从 tar.gz 解出）');
  } catch (err) {
    console.warn(
      '[fundet:browser] 运行时依赖解压失败（安装目录可能无写权限）：',
      err instanceof Error ? err.message : String(err),
      '——浏览器自动化将不可用；可重装到默认目录恢复',
    );
  }
}
