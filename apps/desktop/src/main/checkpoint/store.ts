/**
 * 会话快照与回滚（v1，借鉴 Cindy git-snapshot 的核心机制，裁剪为其多任务/
 * worktree 体系无关的最小内核）：
 *
 * - 每会话一个 bare 快照仓：userData/checkpoints/<sessionId>.git；
 * - 快照 = `git --git-dir=<bare> --work-tree=<workDir> add -A && commit`
 *   （info/exclude 排除 node_modules 等垃圾目录；嵌套 .git 由 git 天然跳过；
 *   无变更不产生空提交）；
 * - 回滚 = 先快照当前态（pre-rollback，可反悔）→ `git checkout <sha> -- .`
 *   恢复目标时点存在/不同的文件 → 删除目标时点之后新增的文件；
 * - git 不可用（未装 Git for Windows 等）时功能整体关闭，探测结果进程内缓存；
 * - 一切失败都不上抛到调用方主链路（发送绝不被快照拖死），只记日志。
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const requireElectron = createRequire(import.meta.url);

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const LIST_LIMIT = 20;
/** 单次快照的变更文件数上限（防误扫巨型目录拖死发送） */
const MAX_CHANGED_FILES = 5000;

/** 快照排除清单（写进 bare 仓 info/exclude） */
const EXCLUDES = [
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  '.fundet-tmp/',
];

export interface CheckpointInfo {
  sha: string;
  createdAt: number;
  /** 快照标签（触发消息的前缀） */
  label: string;
  /** pre-rollback 自动快照标记（回滚列表里降权显示） */
  preRollback: boolean;
}

export interface RewindPreview {
  /** 相对目标时点将恢复的文件（目标有/现无或不同） */
  restore: string[];
  /** 相对目标时点将删除的文件（目标时点之后新增） */
  remove: string[];
}

export interface RewindResult extends RewindPreview {
  preRollbackSha: string | null;
}

let gitAvailable: boolean | null = null;

function probeGit(): boolean {
  try {
    execFileSync('git', ['--version'], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isCheckpointAvailable(): boolean {
  if (gitAvailable === null) {
    gitAvailable = probeGit();
    if (!gitAvailable) console.warn('[fundet:checkpoint] git 不可用，快照/回滚功能关闭');
  }
  return gitAvailable;
}

/**
 * 快照根目录：默认 userData/checkpoints；FUNDET_CHECKPOINT_ROOT 环境变量可覆盖
 * （单测注入临时目录——此时不触 Electron，可在 node --test 里直跑真实 git 流）。
 */
function checkpointsRoot(): string {
  const override = process.env.FUNET_CHECKPOINT_ROOT;
  if (override) return override;
  // 惰性：node --test（注入了覆盖根目录）时不触 Electron 运行时
  const { app } = requireElectron('electron') as typeof import('electron');
  return path.join(app.getPath('userData'), 'checkpoints');
}

function repoDir(sessionId: string): string {
  // sessionId 是 UUID，清洗成文件名安全
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(checkpointsRoot(), `${safe}.git`);
}

async function git(args: string[], opts: { workTree?: string } = {}): Promise<string> {
  const full = [
    ...(opts.workTree ? ['--work-tree', opts.workTree] : []),
    ...args,
  ];
  const { stdout } = await execFileAsync('git', full, {
    // --work-tree 下 pathspec（如 '.'）相对子进程 CWD，必须把 cwd 钉在 workDir
    ...(opts.workTree ? { cwd: opts.workTree } : {}),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function run(dir: string, args: string[], workTree?: string): Promise<string> {
  return git(['--git-dir', dir, ...args], workTree ? { workTree } : {});
}

async function ensureRepo(sessionId: string): Promise<string> {
  const dir = repoDir(sessionId);
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(dir, { recursive: true });
    await git(['init', '--bare', '--quiet', dir]);
    fs.writeFileSync(
      path.join(dir, 'info', 'exclude'),
      `${EXCLUDES.join('\n')}\n`,
      'utf-8',
    );
  }
  return dir;
}

function sanitizeLabel(text: string): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ').trim();
  return oneLine.slice(0, 60) || '（无文本）';
}

/**
 * 创建快照。无变更/失败返回 null（调用方忽略）。label 建议传触发消息文本。
 */
export async function createSnapshot(
  sessionId: string,
  workDir: string,
  label: string,
): Promise<string | null> {
  if (!isCheckpointAvailable()) return null;
  const started = Date.now();
  const dir = await ensureRepo(sessionId);
  await run(dir, ['add', '-A', '--', '.'], workDir);
  // 无变更（--quiet exit 1 = 有 staged 变更；exit 0 = 无）
  let hasChanges = false;
  try {
    await run(dir, ['diff', '--cached', '--quiet']);
  } catch {
    hasChanges = true;
  }
  if (!hasChanges) return null;
  // 变更量护栏
  const stat = await run(dir, ['diff', '--cached', '--name-only']);
  const count = stat.split('\n').filter(Boolean).length;
  if (count > MAX_CHANGED_FILES) {
    console.warn(`[fundet:checkpoint] 变更 ${count} 文件超上限，跳过快照`);
    await run(dir, ['reset', '--quiet']); // 清 staged，不落脏状态
    return null;
  }
  await run(
    dir,
    ['-c', 'user.name=Fundet', '-c', 'user.email=checkpoint@fundet.local', 'commit', '--quiet', '-m', sanitizeLabel(label)],
    workDir,
  );
  const ms = Date.now() - started;
  if (ms > 1500) console.log(`[fundet:checkpoint] 快照耗时 ${ms}ms（${count} 文件）`);
  return headSha(dir);
}

async function headSha(dir: string): Promise<string | null> {
  try {
    const sha = (await run(dir, ['rev-parse', 'HEAD'])).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/** 列出会话快照（新→旧） */
export async function listCheckpoints(sessionId: string): Promise<CheckpointInfo[]> {
  if (!isCheckpointAvailable()) return [];
  const dir = repoDir(sessionId);
  if (!fs.existsSync(path.join(dir, 'HEAD'))) return [];
  const sha = await headSha(dir);
  if (!sha) return [];
  const out = await run(dir, [
    'log', `-n`, String(LIST_LIMIT), '--format=%H%x1f%ct%x1f%s',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ts, subject] = line.split('\x1f');
      return {
        sha: sha ?? '',
        createdAt: Number(ts ?? 0) * 1000,
        label: subject ?? '',
        preRollback: false,
      };
    })
    .filter((c) => c.sha);
}

/** 目标时点 vs 当前 HEAD 的回滚差异预览（--no-renames：R/C 拆成 A/D 精确解析） */
export async function previewRewind(sessionId: string, sha: string): Promise<RewindPreview> {
  const dir = repoDir(sessionId);
  const out = await run(dir, ['diff', '--name-status', '--no-renames', sha, 'HEAD']);
  const restore: string[] = [];
  const remove: string[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    // status\t path（C/M 后跟两个路径，R 后跟 old new —— 回滚语境都按目标态恢复）
    const [status, ...paths] = line.split('\t');
    const p = paths.filter(Boolean).pop() ?? '';
    if (!p) continue;
    if (status === 'A') remove.push(p);
    else restore.push(p);
  }
  return { restore, remove };
}

/** 回滚到目标时点：先落 pre-rollback 快照（可反悔），再恢复+清理 */
export async function rewindTo(sessionId: string, workDir: string, sha: string): Promise<RewindResult> {
  const dir = await ensureRepo(sessionId);
  const preview = await previewRewind(sessionId, sha);
  const preRollbackSha = await createSnapshot(sessionId, workDir, '回滚前自动快照');
  if (preview.restore.length > 0) {
    await run(dir, ['checkout', sha, '--', '.'], workDir);
  }
  for (const p of preview.remove) {
    const target = path.resolve(workDir, p);
    // 只删 workDir 内的（diff 路径来自 git，理论都在树内；防御性再判一次）
    const rootAbs = path.resolve(workDir);
    if (target === rootAbs || target.startsWith(rootAbs + path.sep)) {
      fs.rmSync(target, { force: true });
    }
  }
  // checkout 不动 HEAD：必须落一份「回滚态」提交把 HEAD 对齐恢复后的树，
  // 否则后续 diff 预览/快照全部失配。
  await createSnapshot(sessionId, workDir, `回滚 ${sha.slice(0, 7)}`);
  return { ...preview, preRollbackSha };
}

/** 删除会话的快照仓（session:delete 时调用） */
export function deleteCheckpoints(sessionId: string): void {
  const dir = repoDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 快照清理失败不阻断删会话 */
  }
}
