/**
 * 随包 git tar.gz 解压决策（纯函数，node --test 直跑；执行体在 git-runtime.ts）。
 */
import path from 'node:path';

export interface GitRuntimeExtractDeps {
  exists: (p: string) => boolean;
  read: (p: string) => string;
}

/** 是否需要解压：tgz 与版本在场为前提；目标目录已有同版本 bash 则跳过 */
export function decideGitRuntimeExtract(
  deps: GitRuntimeExtractDeps,
  args: {
    bundledTgz: string;
    targetDir: string;
    extractedMarker: string;
    bundledVersion: string | null;
  },
): boolean {
  if (!deps.exists(args.bundledTgz) || !args.bundledVersion) return false;
  try {
    const marker = deps.read(args.extractedMarker).trim();
    if (marker === args.bundledVersion && deps.exists(path.join(args.targetDir, 'bin', 'bash.exe'))) {
      return false;
    }
  } catch {
    /* 无标记 → 需要解压 */
  }
  return true;
}
