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
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const requireElectron = createRequire(import.meta.url);

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const LIST_LIMIT = 20;
/** 单次快照的变更文件数上限（防误扫巨型目录拖死发送） */
const MAX_CHANGED_FILES = 5000;

/** 快照排除清单（写进 bare 仓 info/exclude）。
    0.2.28 起补系统/缓存巨型目录——此前只有 node_modules，workDir 在 home 时
    AppData 几十万文件全量扫描撞 20s 超时（首条消息慢的最大头）。 */
const EXCLUDES = [
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  '.fundet-tmp/',
  'AppData/',
  'Library/',
  '.cache/',
  '.gradle/',
  '.venv/',
  'venv/',
  '__pycache__/',
  // 0.3.30 大扩充（用户实报 26GB 膨胀：D:\AI 含 IDE/依赖树全量入库）
  'site-packages/',
  '.idea/',
  '.vscode/',
  '.vs/',
  'target/',
  'build/',
  'dist/',
  'out/',
  'vendor/',
  'bin/Debug/',
  'bin/Release/',
  'obj/',
  '.terraform/',
  '.serverless/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.turbo/',
  '.parcel-cache/',
  '.eslintcache',
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.dylib.*',
  '*.a',
  '*.lib',
  '*.o',
  '*.ko',
  '*.pyd',
  '*.wasm',
  '*.pdb',
  '*.exe',
  '*.bin',
  '*.dat',
  '*.pack',
  '*.idx',
  '*.fcgi',
  '*.d',
  '*.suo',
  '*.user',
  '*.sln.docstates',
  '*.ipch',
  '*.tlog',
  '*.lastbuildstate',
  '*.idb',
  '*.ilk',
  '*.ncb',
  '*.sdf',
  '*.opensdf',
  '*.aps',
  '*.rc',
  '*.res',
  '*.tlb',
  '*.iobj',
  '*.ipdb',
];

/** git 超时被 SIGTERM 后残留的 index.lock 视为陈旧的最短年龄（快照已按会话串行，
    到达新快照时还存在的锁只可能是上次被杀的遗物） */
const STALE_LOCK_AGE_MS = 15_000;

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
  const override = process.env.FUNDET_CHECKPOINT_ROOT;
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

/** 清掉上次超时被杀的 git 残留 index.lock（否则该会话快照永久全灭） */
function clearStaleIndexLock(repoDir: string): void {
  const lock = path.join(repoDir, 'index.lock');
  try {
    const st = fs.statSync(lock);
    if (Date.now() - st.mtimeMs > STALE_LOCK_AGE_MS) {
      fs.rmSync(lock);
      console.warn('[fundet:checkpoint] 清除陈旧 index.lock（上次快照超时残留）');
    }
  } catch {
    /* 无锁文件，正常路径 */
  }
}

/**
 * 创建快照。无变更/失败返回 null（调用方忽略）。label 建议传触发消息文本。
 * workDir 是用户主目录时跳过：全量扫描代价不可接受，回滚整个 home 也不现实。
 */
export async function createSnapshot(
  sessionId: string,
  workDir: string,
  label: string,
): Promise<string | null> {
  if (!isCheckpointAvailable()) return null;
  if (path.resolve(workDir) === homedir()) {
    console.log('[fundet:checkpoint] workDir 为主目录，跳过快照（请在会话里选择具体工作文件夹）');
    return null;
  }
  const started = Date.now();
  const dir = await ensureRepo(sessionId);
  clearStaleIndexLock(dir);
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
  const sha = await headSha(dir);
  // 后台维护（LRU 修剪 + 定期 gc）——不等它，不挡返回
  void maintainRepo(sessionId, dir);
  const ms = Date.now() - started;
  if (ms > 1500) console.log(`[fundet:checkpoint] 快照耗时 ${ms}ms（${count} 文件）`);
  return sha;
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
  clearStaleIndexLock(dir);
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

/** 删除会话的快照仓（session:delete 时调用）。同步版：启动清扫等阻塞场景 */
export function deleteCheckpoints(sessionId: string): void {
  const dir = repoDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 快照清理失败不阻断删会话 */
  }
}

/** 删除会话的快照仓——异步版（session:delete 用）：仓可达数百 MB，
 *  同步 rmSync 会冻结主进程事件循环，删除会话即整体卡顿（2026-10-07 实报） */
export async function deleteCheckpointsAsync(sessionId: string): Promise<void> {
  const dir = repoDir(sessionId);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* 快照清理失败不阻断删会话 */
  }
}

/* ---------------- 磁盘治理（0.3.30，用户实报 26GB 膨胀根修） ---------------- */

/** 每会话保留的最大快照条数（超出删最旧提交） */
const MAX_SNAPSHOTS_PER_SESSION = 20;
/** 快照仓体积软上限（超过时启动 gc 并警告日志） */
const REPO_GC_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512MB
/** 轮末触发的 gc 间隔（每 N 次快照跑一次 gc --prune） */
const GC_EVERY_N_SNAPSHOTS = 10;

/** 启动时清扫孤儿仓：checkpoints 目录里有 .git 但 sessions 表里无对应会话 */
export function cleanupOrphanCheckpoints(validSessionIds: Set<string>): number {
  if (!isCheckpointAvailable()) return 0;
  const root = checkpointsRoot();
  let removed = 0;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.endsWith('.git')) continue;
      const sessionId = e.name.replace(/\.git$/, '');
      if (!validSessionIds.has(sessionId)) {
        try {
          fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
          removed++;
          console.warn(`[fundet:checkpoint] 清扫孤儿仓 ${e.name}（sessions 表无此会话）`);
        } catch {
          /* 清理失败不阻断启动 */
        }
      }
    }
  } catch {
    /* 目录不存在（从未拍过快照） */
  }
  if (removed > 0) console.log(`[fundet:checkpoint] 启动清扫孤儿仓 ${removed} 个`);
  return removed;
}

/** 递归算目录磁盘占用（bytes）——异步版（此前同步递归走整个 checkpoints 目录
 *  会阻塞主进程事件循环冻结全部 IPC，用户实报按钮无响应，2026-10-04） */
export async function checkpointDiskUsageAsync(): Promise<number> {
  const root = checkpointsRoot();
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else total += (await fs.promises.stat(p)).size;
      }
    } catch {
      /* ignore */
    }
  };
  await walk(root);
  return total;
}

/** 删除全部快照（设置页一键清理） */
export function purgeAllCheckpoints(): void {
  const root = checkpointsRoot();
  try {
    fs.rmSync(root, { recursive: true, force: true });
    console.log('[fundet:checkpoint] 全量清理完成');
  } catch {
    /* ignore */
  }
}

/** 每会话的快照计数器（够 GC_EVERY_N_SNAPSHOTS 时触发 gc） */
const snapshotCounters = new Map<string, number>();

/** 快照后维护：LRU 修剪 + 定期 gc + 体积监控 */
async function maintainRepo(sessionId: string, dir: string): Promise<void> {
  try {
    // 计数器递增
    const count = (snapshotCounters.get(sessionId) ?? 0) + 1;
    snapshotCounters.set(sessionId, count);

    // LRU 修剪：超出上限删最旧提交
    const logOut = await run(dir, ['log', '--format=%H']);
    const shas = logOut.split('\n').filter(Boolean);
    if (shas.length > MAX_SNAPSHOTS_PER_SESSION) {
      // 保留前 MAX_SNAPSHOTS_PER_SESSION 个，把更老的分支截断到第 N 个的 parent
      const keepSha = shas[MAX_SNAPSHOTS_PER_SESSION - 1];
      // git update-ref refs/heads/main <keepSha> + git reflog expire --expire=now --all + git gc --prune=now
      await run(dir, ['update-ref', 'HEAD', keepSha]);
      await run(dir, ['reflog', 'expire', '--expire=now', '--all']);
      await run(dir, ['gc', '--prune=now', '--quiet']);
      console.log(`[fundet:checkpoint] LRU 修剪：${shas.length} → ${MAX_SNAPSHOTS_PER_SESSION} 条`);
    }

    // 定期 gc（松散对象打包，防磁盘膨胀）
    if (count % GC_EVERY_N_SNAPSHOTS === 0) {
      await run(dir, ['gc', '--auto', '--quiet']);
    }
  } catch (err) {
    console.warn('[fundet:checkpoint] 快照后维护失败（不影响快照）', err);
  }
}

/** 每会话一条串行链：同一 bare 仓上并发 git 会撞 index.lock */
const snapshotChains = new Map<string, Promise<void>>();

/**
 * 后台快照（fire-and-forget）：立即返回，消息发送零等待。
 * 0.2.28 前这里是 `await createSnapshot`——workDir 大时 git add 全量扫描
 * 直接把首条消息卡 20s+（超时被 SIGTERM），"失败不阻断"实际只对失败成立、
 * 对慢不成立。改为后台串行后：锚点仍在 turn 开始前后落，但不再挡路。
 */
export function enqueueSnapshot(sessionId: string, workDir: string, label: string): void {
  const prev = snapshotChains.get(sessionId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => createSnapshot(sessionId, workDir, label))
    .then(
      () => undefined,
      (err) => {
        console.warn('[fundet:checkpoint] 后台快照失败（不影响会话）', err);
      },
    );
  snapshotChains.set(sessionId, next);
  void next.finally(() => {
    if (snapshotChains.get(sessionId) === next) snapshotChains.delete(sessionId);
  });
}

/** 等待某会话的后台快照链排空（轮末 diff 取基准前用；单测也用） */
export function waitForSnapshotQueue(sessionId: string): Promise<void> {
  return snapshotChains.get(sessionId) ?? Promise.resolve();
}

/** 兼容旧名单测引用 */
export const snapshotChainsForTest = waitForSnapshotQueue;

export interface TurnFileChange {
  path: string;
  additions: number;
  deletions: number;
}

/** git 空树对象（首轮无 base 时 diff 出全量新增） */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * 轮末改动统计（2026-09-30，对齐 Cindy TurnChangesCard 的数据面 v1）：
 * 调用方先 waitForSnapshotQueue 取 base=HEAD（轮前快照已落），再本函数补拍
 * 轮末快照后 numstat。无仓/无变更返回 []。口径：轮内用户手改也会计入（v1
 * 接受， Cindy 式前像捕获是后续精度升级）。
 */
export async function captureTurnDiff(
  sessionId: string,
  workDir: string,
  baseSha: string | null,
  label: string,
): Promise<TurnFileChange[]> {
  if (!isCheckpointAvailable()) return [];
  if (path.resolve(workDir) === homedir()) return [];
  await createSnapshot(sessionId, workDir, label);
  const dir = repoDir(sessionId);
  if (!fs.existsSync(path.join(dir, 'HEAD'))) return [];
  const head = await headSha(dir);
  if (!head) return [];
  const base = baseSha ?? EMPTY_TREE_SHA;
  if (base === head) return [];
  let out: string;
  try {
    out = await run(dir, ['diff', '--numstat', base, head]);
  } catch {
    return [];
  }
  const files: TurnFileChange[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [a, d, p] = line.split('\t');
    if (!p) continue;
    // 二进制文件 numstat 显示 "-\t-"：计 0/0 但保留行（能点开看）
    files.push({
      path: p,
      additions: Number.isFinite(Number(a)) ? Number(a) : 0,
      deletions: Number.isFinite(Number(d)) ? Number(d) : 0,
    });
  }
  return files;
}

/** 当前 HEAD（无仓/空仓 null）——轮末 diff 的 base 取值用 */
export async function currentCheckpointHead(sessionId: string): Promise<string | null> {
  if (!isCheckpointAvailable()) return null;
  const dir = repoDir(sessionId);
  if (!fs.existsSync(path.join(dir, 'HEAD'))) return null;
  return headSha(dir);
}
