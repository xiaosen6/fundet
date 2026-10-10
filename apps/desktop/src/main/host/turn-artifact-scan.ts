/**
 * 轮末产物扫描纯逻辑（node 内置依赖，node --test 直跑，无 electron）。
 *
 * 数据流：SESSION_SEND（非 retry）对会话 workDir 拍文件快照（Map<path, mtimeMs>，
 * 顶层 + 一层子目录，仅白名单扩展名）；turn 终态 diff（新增或 mtime 变化）→
 * mtime 倒序截 12 → PUSH turn:artifacts。bash/python 等脚本生成的 pptx/png
 * 等产物由此进 Canvas——write/edit 工具面继续走 collectArtifacts，两者互补。
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { extOf } from '../../shared/file-kind.ts';

/** 文件快照：绝对路径 → mtimeMs（轮前基线 / 轮末当前态共用同一结构） */
export type TurnArtifactSnapshot = Map<string, number>;

/** 快照条目上限（防大目录拖慢主进程：readdir 全枚举便宜，stat 只打白名单文件） */
export const SNAPSHOT_MAX_FILES = 800;
/** 单轮推送产物数上限（mtime 倒序截断） */
export const TURN_ARTIFACT_MAX = 12;

/** 依赖仓/缓存/附件暂存排除；一切点开头目录也排除（fundet-images 无点前缀，收） */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', '.venv', '__pycache__', '.fundet-uploads']);

export function isExcludedDirName(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIR_NAMES.has(name);
}

/** 产物扩展名白名单：文档/媒体/数据 + 常见脚本（write 工具收不到的 bash 生成脚本也有用） */
const ARTIFACT_EXTS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xlsm',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.mp3',
  '.wav',
  '.mp4',
  '.csv',
  '.zip',
  '.7z',
  '.html',
  '.htm',
  '.json',
  '.md',
  '.txt',
  '.py',
  '.js',
  '.ts',
]);

export function isArtifactPath(filePath: string): boolean {
  return ARTIFACT_EXTS.has(extOf(filePath));
}

/** diff：白名单内新增或 mtime 变化的文件，mtime 倒序，截 TURN_ARTIFACT_MAX */
export function diffArtifacts(
  baseline: TurnArtifactSnapshot,
  current: TurnArtifactSnapshot,
): string[] {
  const changed: Array<{ path: string; mtimeMs: number }> = [];
  for (const [filePath, mtimeMs] of current) {
    if (!isArtifactPath(filePath)) continue;
    if (baseline.get(filePath) === mtimeMs) continue;
    changed.push({ path: filePath, mtimeMs });
  }
  changed.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return changed.slice(0, TURN_ARTIFACT_MAX).map((c) => c.path);
}

async function listDirNames(dir: string): Promise<{ files: string[]; dirs: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.isFile()) files.push(e.name);
    else if (e.isDirectory() && !isExcludedDirName(e.name)) dirs.push(e.name);
  }
  return { files, dirs };
}

/**
 * 扫 workDir 顶层 + 一层子目录（不再下钻），返回白名单文件的 mtime 快照。
 * 快照只记白名单扩展名——非白名单文件不可能成为产物，省掉它们的 stat。
 * workDir 不存在/不可读时抛错（调用方静默跳过）。
 */
export async function scanArtifactSnapshot(
  workDir: string,
  maxFiles: number = SNAPSHOT_MAX_FILES,
): Promise<TurnArtifactSnapshot> {
  const snapshot: TurnArtifactSnapshot = new Map();
  const record = async (dir: string, names: string[]): Promise<void> => {
    for (const name of names) {
      if (snapshot.size >= maxFiles) return;
      if (!isArtifactPath(name)) continue;
      const full = path.join(dir, name);
      try {
        snapshot.set(full, (await stat(full)).mtimeMs);
      } catch {
        /* 扫描窗口内被删：跳过 */
      }
    }
  };
  const top = await listDirNames(workDir);
  await record(workDir, top.files);
  for (const name of top.dirs) {
    if (snapshot.size >= maxFiles) break;
    const sub = path.join(workDir, name);
    try {
      const listing = await listDirNames(sub);
      await record(sub, listing.files);
    } catch {
      /* 子目录消失/无权限：跳过 */
    }
  }
  return snapshot;
}
