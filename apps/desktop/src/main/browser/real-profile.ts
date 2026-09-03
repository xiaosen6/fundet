/**
 * 系统浏览器登录态拷贝（对齐 Cindy browser-real-profile，精简为单托管 profile 版）。
 *
 * 开关开启：把系统 Chrome/Edge/Brave 最近使用 profile 的 Cookies/密码库
 * 一致性快照（SQLite online-backup，源浏览器开着也能拷）进 Fundet 托管浏览器的
 * user-data（覆盖其中的登录状态）；开关关闭：清除托管浏览器里的这些登录库，
 * 恢复空白。拷贝/清除前必须先停掉托管浏览器（host.stopManagedRuntime）。
 *
 * 这是用户同意后的便利功能，不是隔离边界——与本机同一用户身份运行。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { brand } from '../../shared/brand.ts';

export type ChromiumKind = 'chrome' | 'edge' | 'brave';

const COMPLETE_MARKER = '.fundet-real-profile-complete';

/** 认证类 SQLite 库：必须一致性拷贝（Cookies 新版在 Network/ 下）。 */
const AUTH_DB_RELATIVE_PATHS = [
  'Cookies',
  path.join('Network', 'Cookies'),
  'Login Data',
  'Login Data For Account',
  'Web Data',
] as const;

const PLAIN_PROFILE_FILES = ['Preferences'] as const;

const SQLITE_SIDECARS = ['-wal', '-shm', '-journal'] as const;

export class RealProfileError extends Error {
  readonly code:
    | 'NO_CHROMIUM'
    | 'PROFILE_LOCKED'
    | 'NO_AUTH_DB'
    | 'COPY_FAILED'
    | 'APP_BOUND_ENCRYPTION';

  constructor(code: RealProfileError['code'], message: string) {
    super(message);
    this.name = 'RealProfileError';
    this.code = code;
  }
}

function userDataMember(kind: ChromiumKind): string {
  switch (kind) {
    case 'chrome':
      return path.join('Google', 'Chrome', 'User Data');
    case 'edge':
      return path.join('Microsoft', 'Edge', 'User Data');
    case 'brave':
      return path.join('BraveSoftware', 'Brave-Browser', 'User Data');
  }
}

/** 各平台系统 Chromium 的 User Data 目录候选（按 kind）。 */
export function userDataDirFor(kind: ChromiumKind, platform: NodeJS.Platform = process.platform): string | null {
  const member = userDataMember(kind);
  if (platform === 'win32') {
    const local = process.env['LOCALAPPDATA'];
    return local ? path.join(local, member) : null;
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', member);
  }
  if (platform === 'linux') {
    return path.join(os.homedir(), '.config', member);
  }
  return null;
}

export interface InstalledChromium {
  kind: ChromiumKind;
  userDataDir: string;
}

/** 探测本机已装 Chromium 系浏览器（按 Local State 新旧排序，chrome 优先）。 */
export function listInstalledChromium(platform: NodeJS.Platform = process.platform): InstalledChromium[] {
  const kinds: ChromiumKind[] = ['chrome', 'edge', 'brave'];
  const found: Array<InstalledChromium & { mtime: number }> = [];
  for (const kind of kinds) {
    const dir = userDataDirFor(kind, platform);
    if (!dir || !fs.existsSync(dir)) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(dir, 'Local State')).mtimeMs;
    } catch {
      mtime = fs.statSync(dir).mtimeMs;
    }
    found.push({ kind, userDataDir: dir, mtime });
  }
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ kind, userDataDir }) => ({ kind, userDataDir }));
}

/** Local State 里最近使用的 profile 目录名（缺省 Default）。 */
export function lastUsedProfileName(localStateRaw: string): string {
  try {
    const parsed = JSON.parse(localStateRaw) as { profile?: { last_used?: unknown } };
    const lastUsed = parsed.profile?.last_used;
    if (typeof lastUsed === 'string' && lastUsed.trim()) return lastUsed.trim();
  } catch {
    // Local State 缺失/损坏时回落 Default。
  }
  return 'Default';
}

/**
 * 改写拷贝来的 Local State：把 last_used 指到 Default、只保留 Default 的
 * info_cache（名字标成 Fundet）。原样拷贝会让 Chrome 打开源 profile 目录
 * （常是空的 Profile 2）看起来像没登录。
 */
export function rewriteLocalStateForManagedDefault(localStateRaw: string, sourceProfile: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(localStateRaw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const profile = { ...((parsed['profile'] as Record<string, unknown>) ?? {}) };
  const infoCache = ((profile['info_cache'] as Record<string, unknown>) ?? {});
  const sourceInfo = {
    ...((infoCache[sourceProfile] as Record<string, unknown>) ?? (infoCache['Default'] as Record<string, unknown>) ?? {}),
  };
  sourceInfo['name'] = brand.name;
  sourceInfo['shortcut_name'] = brand.name;
  sourceInfo['user_name'] = brand.name;
  profile['last_used'] = 'Default';
  profile['last_active_profiles'] = ['Default'];
  profile['profiles_order'] = ['Default'];
  profile['profiles_created'] = 1;
  profile['show_picker_on_startup'] = false;
  profile['info_cache'] = { Default: sourceInfo };
  return `${JSON.stringify({ ...parsed, profile })}\n`;
}

/** Windows 下 Chrome 运行时会锁 Cookie 库：r+ 打开探测。 */
export function profileIsLocked(profileDir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  for (const relative of ['Cookies', path.join('Network', 'Cookies')]) {
    const cookieDb = path.join(profileDir, relative);
    if (!fs.existsSync(cookieDb)) continue;
    try {
      const fd = fs.openSync(cookieDb, 'r+');
      fs.closeSync(fd);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') return true;
    }
  }
  return false;
}

/**
 * 托管浏览器判停：status 数据里 running=true 或 pid 还在都算活着（只看
 * running 会漏掉「进程还在、标志未置位」的中间态）。返回 null=状态读不出来。
 */
export function managedRuntimeNeedsStop(data: unknown): boolean | null {
  if (data === null || typeof data !== 'object') return null;
  const rec = data as { running?: unknown; pid?: unknown };
  const running = typeof rec['running'] === 'boolean' ? rec['running'] : null;
  const pid = rec['pid'];
  const pidPresent =
    pid === undefined || pid === null
      ? false
      : typeof pid === 'number' && Number.isInteger(pid) && pid > 0
        ? true
        : null;
  if (running === null || pidPresent === null) return null;
  return running || pidPresent;
}

/**
 * Chrome 127+ 在 Windows 上用 App-Bound 加密（encrypted_value v20 前缀），
 * 密钥经系统服务绑定原浏览器与原 user-data——拷到托管 profile 后解不开，
 * 检出即拒绝拷贝，不让用户拿到「看起来拷好了、实际全没登录」的状态。
 */
export function profileUsesAppBoundEncryption(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return false;
  for (const relative of ['Cookies', path.join('Network', 'Cookies')]) {
    const cookieDb = path.join(profileDir, relative);
    if (!fs.existsSync(cookieDb)) continue;
    const db = new Database(cookieDb, { readonly: true, timeout: 5000 });
    try {
      const columns = db.prepare('PRAGMA table_info(cookies)').all() as Array<{ name?: unknown }>;
      if (!columns.some((column) => column.name === 'encrypted_value')) continue;
      const row = db
        .prepare("SELECT 1 AS detected FROM cookies WHERE substr(encrypted_value, 1, 3) = x'763230' LIMIT 1")
        .get();
      if (row !== undefined) return true;
    } finally {
      db.close();
    }
  }
  return false;
}

function removeSqliteAndSidecars(filePath: string): void {
  // Windows 下 Defender/索引器会短暂握住刚关掉的库：带重试删
  fs.rmSync(filePath, { force: true, maxRetries: 3, retryDelay: 100 });
  for (const suffix of SQLITE_SIDECARS) {
    fs.rmSync(filePath + suffix, { force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function secureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Windows 不总能 chmod，快照本就在 userData 下。
  }
}

/** SQLite online-backup：源库开着也能得到一致快照（copyFile+sidecar 不行）。 */
function copySqliteDatabase(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  removeSqliteAndSidecars(dest);
  const source = new Database(src, { readonly: true, timeout: 5000 });
  try {
    source.backup(dest);
  } finally {
    source.close();
  }
}

function publishStagedFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  removeSqliteAndSidecars(dest);
  fs.renameSync(src, dest);
  for (const suffix of SQLITE_SIDECARS) {
    const side = src + suffix;
    if (fs.existsSync(side)) fs.renameSync(side, dest + suffix);
  }
}

/** 托管 profile 目录：browser/Fundet/user-data（相对 runtime 根）。 */
export function managedUserDataMember(): { profileDirName: string; userDataDir: string } {
  const runtimeDir = process.env['XDT_BROWSER_RUNTIME_DIR'] ?? '';
  return { profileDirName: 'Fundet', userDataDir: path.join(runtimeDir, 'browser', 'Fundet', 'user-data') };
}

/**
 * 快照拷贝：系统浏览器最近 profile → Fundet 托管 user-data。
 * 先 stage 到临时目录再原子发布；完成后写完成标记。
 */
export function snapshotRealProfile(options: {
  source: InstalledChromium;
  destDir: string;
  platform?: NodeJS.Platform;
}): { sourceKind: ChromiumKind; sourceProfile: string } {
  const platform = options.platform ?? process.platform;
  const destDir = options.destDir;
  if (path.basename(destDir) !== 'user-data') {
    throw new RealProfileError('COPY_FAILED', `拒绝写入非 user-data 目录：${destDir}`);
  }

  const localStatePath = path.join(options.source.userDataDir, 'Local State');
  let localStateRaw = '{}';
  try {
    if (fs.existsSync(localStatePath)) localStateRaw = fs.readFileSync(localStatePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      throw new RealProfileError('NO_AUTH_DB', '无法读取系统浏览器的配置目录（权限不足）。');
    }
    throw err;
  }
  const sourceProfile = lastUsedProfileName(localStateRaw);
  const sourceProfileDir = path.join(options.source.userDataDir, sourceProfile);
  if (!fs.existsSync(sourceProfileDir)) {
    throw new RealProfileError('NO_AUTH_DB', `系统浏览器 profile 目录「${sourceProfile}」不存在。`);
  }
  if (profileIsLocked(sourceProfileDir, platform)) {
    throw new RealProfileError(
      'PROFILE_LOCKED',
      '系统浏览器正在锁定它的 Cookie 数据库。请完全退出系统浏览器（包括托盘图标）后重试。',
    );
  }
  if (platform === 'win32') {
    // 拷贝前先验 App-Bound 加密：库被占用时报锁定（与 profileIsLocked 同口径），
    // 其余读库失败按 COPY_FAILED 处理
    try {
      if (profileUsesAppBoundEncryption(sourceProfileDir)) {
        throw new RealProfileError(
          'APP_BOUND_ENCRYPTION',
          '系统浏览器的 Cookie 使用了 Chrome 127+ 的 App-Bound 加密，拷贝到托管浏览器后无法解密。请在托管浏览器里直接登录网站。',
        );
      }
    } catch (err) {
      if (err instanceof RealProfileError) throw err;
      const code = (err as NodeJS.ErrnoException).code ?? '';
      const text = String(code);
      if (code === 'EPERM' || code === 'EACCES' || text.includes('BUSY') || text.includes('CANTOPEN')) {
        throw new RealProfileError(
          'PROFILE_LOCKED',
          '系统浏览器正在锁定它的 Cookie 数据库。请完全退出系统浏览器后重试。',
        );
      }
      throw new RealProfileError('COPY_FAILED', '拷贝前检查 Cookie 库失败。');
    }
  }

  secureDir(path.dirname(destDir));
  let stagingDir = '';
  try {
    stagingDir = fs.mkdtempSync(`${destDir}.staging-`);
    secureDir(stagingDir);
    const stagingProfileDir = path.join(stagingDir, 'Default');
    secureDir(path.join(stagingProfileDir, 'Network'));

    fs.writeFileSync(path.join(stagingDir, 'Local State'), rewriteLocalStateForManagedDefault(localStateRaw, sourceProfile), 'utf8');

    let authDbCopied = 0;
    let copiedCookie = false;
    for (const relative of AUTH_DB_RELATIVE_PATHS) {
      const src = path.join(sourceProfileDir, relative);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(stagingProfileDir, relative);
      try {
        copySqliteDatabase(src, dest);
        authDbCopied += 1;
        if (relative === 'Cookies' || relative === path.join('Network', 'Cookies')) copiedCookie = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          throw new RealProfileError(
            'PROFILE_LOCKED',
            '系统浏览器正在锁定它的 Cookie 数据库。请完全退出系统浏览器后重试。',
          );
        }
        throw new RealProfileError('COPY_FAILED', `拷贝 ${relative} 失败。`);
      }
    }
    if (!copiedCookie || authDbCopied === 0) {
      throw new RealProfileError('NO_AUTH_DB', '未能从系统浏览器拷出 Cookie 或密码库。');
    }

    for (const relative of PLAIN_PROFILE_FILES) {
      const src = path.join(sourceProfileDir, relative);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(stagingProfileDir, relative));
    }

    // 原子发布：staging → 托管 user-data
    secureDir(destDir);
    const destProfileDir = path.join(destDir, 'Default');
    secureDir(path.join(destProfileDir, 'Network'));
    publishStagedFile(path.join(stagingDir, 'Local State'), path.join(destDir, 'Local State'));
    for (const relative of [...AUTH_DB_RELATIVE_PATHS, ...PLAIN_PROFILE_FILES]) {
      const stagingFile = path.join(stagingProfileDir, relative);
      const destFile = path.join(destProfileDir, relative);
      if (fs.existsSync(stagingFile)) {
        publishStagedFile(stagingFile, destFile);
      } else {
        removeSqliteAndSidecars(destFile);
      }
    }
    fs.writeFileSync(
      path.join(destDir, COMPLETE_MARKER),
      JSON.stringify({ sourceProfile, sourceKind: options.source.kind }),
      'utf8',
    );
    return { sourceKind: options.source.kind, sourceProfile };
  } catch (err) {
    if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }
}

/** 清除托管浏览器里拷贝来的登录库（关闭开关时恢复空白）。 */
export function clearCopiedLogins(destDir: string): void {
  const destProfileDir = path.join(destDir, 'Default');
  for (const relative of AUTH_DB_RELATIVE_PATHS) {
    removeSqliteAndSidecars(path.join(destProfileDir, relative));
  }
  fs.rmSync(path.join(destDir, COMPLETE_MARKER), { force: true });
}

/** 完成标记是否存在（= 托管浏览器当前带拷贝来的登录态）。 */
export function realLoginsApplied(destDir: string): boolean {
  return fs.existsSync(path.join(destDir, COMPLETE_MARKER));
}
