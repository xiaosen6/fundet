/**
 * pi 二进制路径解析。
 *
 * dev：从 app.getAppPath()（apps/desktop）推导仓库根，取 apps/pi-bin/<platform>-<arch>/pi。
 *      整目录（theme、node_modules 等）必须在场，缺 theme 时 RPC 模式即崩。
 * 打包：apps/pi-bin/ 整目录经 electron-builder extraResources 拷到 resources/pi/，
 *      取 process.resourcesPath/pi/<platform>-<arch>/pi。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function resolvePiBinaryPath(): string {
  const binName = process.platform === 'win32' ? 'pi.exe' : 'pi';
  const platformDir = `${process.platform}-${process.arch}`;

  if (app.isPackaged) {
    const bin = path.join(process.resourcesPath, 'pi', platformDir, binName);
    if (!fs.existsSync(bin)) {
      throw new Error(`打包产物缺少 pi 二进制: ${bin}（extraResources 未包含 apps/pi-bin/${platformDir}/）`);
    }
    return bin;
  }

  // apps/desktop → 仓库根
  const repoRoot = path.resolve(app.getAppPath(), '..', '..');
  const bin = path.join(repoRoot, 'apps', 'pi-bin', platformDir, binName);
  if (!fs.existsSync(bin)) {
    throw new Error(`pi 二进制不存在: ${bin}（请先准备 apps/pi-bin/${platformDir}/）`);
  }
  return bin;
}

/**
 * ripgrep 路径：优先仓库 apps/ripgrep-bin/<platform>-<arch>/rg，其次系统 PATH 里的 rg。
 * 下发绝对路径而非依赖 PATH（对齐 Cindy 的防劫持考虑）。找不到返回 undefined，
 * pi 退回自身解析逻辑。
 */
export function resolveRipgrepPath(): string | undefined {
  const binName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const platformDir = `${process.platform}-${process.arch}`;
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'ripgrep-bin', platformDir, binName));
  } else {
    const repoRoot = path.resolve(app.getAppPath(), '..', '..');
    candidates.push(path.join(repoRoot, 'apps', 'ripgrep-bin', platformDir, binName));
  }
  // 系统 rg（WSL 下 /usr/bin/rg）
  candidates.push(path.join('/usr/bin', binName), path.join('/usr/local/bin', binName));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(p, 0o755);
        } catch {
          // 系统目录无权限 chmod 时忽略，文件通常已可执行
        }
      }
      return p;
    }
  }
  return undefined;
}
