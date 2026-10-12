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
/** 末轮时间窗尾巴（秒）：done 消息落库后脚本还在收尾写文件的余量 */
export const LAST_TURN_TAIL_MS = 120_000;

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

/**
 * 老会话回填：把「现在扫到的文件 mtime」按消息时间窗归属到轮次。
 * ---------------------------------------------------------------------------
 * 场景：0.3.45 前轮末扫描只 push 不落库，老会话重开后产出卡只剩 write 脚本
 * （用户实报：卡上只有 gen_pptx.js 没有 PDF/Word/PPT）。修复后的新轮次有
 * turn_artifacts 落库行；老轮次没有——这里用「文件 mtime 落在该轮 user 消息
 * 到下一轮 user 消息之间」归属，语义与 live 扫描（轮内 mtime 变化）一致，
 * 只是边界更粗（轮间用户手动放进来的文件也会归上一轮，v1 接受）。
 * 文件在窗口外的（会话开始前就存在/结束后才出现）不归属。
 * 每轮 mtime 倒序截 TURN_ARTIFACT_MAX，与 live 推送同口径。
 */
export function attributeFilesToTurnWindows(
  files: ReadonlyArray<{ path: string; mtimeMs: number }>,
  windows: ReadonlyArray<{ startAt: number; endAt: number }>,
): Array<{ turnIndex: number; paths: string[] }> {
  const buckets = windows.map(() => [] as Array<{ path: string; mtimeMs: number }>);
  for (const f of files) {
    if (!isArtifactPath(f.path)) continue;
    // 窗口按 startAt 升序，找最后一个 startAt <= mtime 的（且 mtime < endAt）
    for (let i = windows.length - 1; i >= 0; i--) {
      const w = windows[i]!;
      if (f.mtimeMs >= w.startAt && f.mtimeMs < w.endAt) {
        buckets[i]!.push(f);
        break;
      }
    }
  }
  const out: Array<{ turnIndex: number; paths: string[] }> = [];
  buckets.forEach((b, i) => {
    if (b.length === 0) return;
    b.sort((x, y) => y.mtimeMs - x.mtimeMs);
    out.push({ turnIndex: i, paths: b.slice(0, TURN_ARTIFACT_MAX).map((f) => f.path) });
  });
  return out;
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
