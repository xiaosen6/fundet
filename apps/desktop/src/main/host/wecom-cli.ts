/**
 * 企业微信 CLI（wecom-cli）桥：探测 / 安装 / 扫码登录 / 状态 / 官方技能装配。
 *
 * wecom-cli = 企业微信开放平台官方 CLI（MIT，WecomTeam/wecom-cli），Rust 单二进制，
 * 以用户扫码绑定的机器人身份操作企业微信（消息/邮件/文档/待办/日程/会议/微盘/
 * 通讯录）。Fundet 不捆绑二进制、不做 API 代理，只负责四步引导：
 *   ① 安装：官方 npm 发行包 @wecom/cli-<os>-<arch> 里的原生程序（npm 主包只是
 *      Node 启动器；直接取平台包里的 exe 与经 npm 安装等价，且不要求本机装
 *      Node），按 registry 登记的 sha512 校验后落到 ~/.local/bin（与 dws.exe 同目录）
 *   ② wecom-cli auth init --noninteractive --no-browser --output-qrcode（后台隐藏
 *      运行，二维码 PNG 取回面板展示，用户用企业微信扫码）
 *   ③ 官方技能：仓库 skills/wecomcli-* 平铺到 ~/.agents/skills（内容指纹校验）
 *   ④ 状态探测（--version / auth show）
 * Agent 执行 wecom-cli 走普通 shell 命令，过既有命令确认闸。
 *
 * electron 依赖全部惰性 require（node --test 导入纯函数不能拉起 electron）；
 * 落盘位置可由 home 参数注入（探针用临时 HOME 跑通真实链路）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { killProcessTree, runCliCommand, tailOf, type CliRunResult } from './cli-run.ts';
import { ensureUserLocalBinOnPath } from './local-bin-path.ts';
import { validateSkillMarkdown } from './skill-frontmatter.ts';
import { extractTgz, type TgzEntry } from './tgz-extract.ts';
import type { OfficeLoginState } from '../../shared/fundet-api.ts';

const requireElectron = createRequire(import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const META_TIMEOUT_MS = 30_000;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_META_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
/** 扫码等待上限与 CLI 一致（qrcode.rs POLL_TIMEOUT = 300s） */
export const WECOM_QR_WAIT_MS = 5 * 60_000;
/** 二维码 PNG 落地等待（实测约 2s；网络慢留余量） */
const QR_READY_TIMEOUT_MS = 30_000;
/** 登录结果（成功/过期/失败）在状态里保留多久供面板读取 */
const LOGIN_OUTCOME_TTL_MS = 10 * 60_000;

export type WecomInstallSource = 'mirror' | 'npm';

/** 国内镜像在前：npmmirror 同步官方包且 integrity 与 npmjs 一致（2026-11 实测） */
export const WECOM_REGISTRIES: Record<WecomInstallSource, string> = {
  mirror: 'https://registry.npmmirror.com',
  npm: 'https://registry.npmjs.org',
};

export interface WecomStatusView {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  botId?: string;
  skills: string[];
}

export interface WecomActionResult {
  ok: boolean;
  output: string;
  url?: string;
  qrDataUrl?: string;
}

/* ---------------- 纯解析（单测覆盖） ---------------- */

export function wecomPlatformPackage(platform: NodeJS.Platform, arch: string): string | null {
  switch (`${platform}-${arch}`) {
    case 'win32-x64':
      return '@wecom/cli-win32-x64';
    case 'darwin-x64':
      return '@wecom/cli-darwin-x64';
    case 'darwin-arm64':
      return '@wecom/cli-darwin-arm64';
    case 'linux-x64':
      return '@wecom/cli-linux-x64';
    case 'linux-arm64':
      return '@wecom/cli-linux-arm64';
    default:
      return null;
  }
}

export function wecomBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli';
}

export interface WecomDist {
  version: string;
  tarball: string;
  integrity: string | null;
  shasum: string | null;
}

/** registry 元数据里取最新版的下载信息；tarball 不在本 registry 时按 npm 规范路径拼 */
export function pickWecomDist(meta: unknown, registry: string, pkg: string): WecomDist | null {
  const m = meta as {
    'dist-tags'?: Record<string, unknown>;
    versions?: Record<string, { dist?: { tarball?: unknown; integrity?: unknown; shasum?: unknown } }>;
  } | null;
  if (!m || typeof m !== 'object' || !m.versions) return null;
  const tags = m['dist-tags'] ?? {};
  const version =
    typeof tags.latest === 'string' && m.versions[tags.latest] ? tags.latest : Object.keys(m.versions).at(-1);
  if (!version) return null;
  const dist = m.versions[version]?.dist;
  let tarball = typeof dist?.tarball === 'string' && /^https:\/\//i.test(dist.tarball) ? dist.tarball : '';
  // 元数据里的下载地址必须仍落在所选 registry（防元数据把下载引到别处）
  if (!tarball || new URL(tarball).origin !== new URL(registry).origin) {
    tarball = `${registry}/${pkg}/-/${pkg.split('/')[1]}-${version}.tgz`;
  }
  return {
    version,
    tarball,
    integrity: typeof dist?.integrity === 'string' ? dist.integrity : null,
    shasum: typeof dist?.shasum === 'string' ? dist.shasum : null,
  };
}

function digestOf(algo: string, buf: Buffer): Buffer | null {
  try {
    return createHash(algo).update(buf).digest();
  } catch {
    return null;
  }
}

/**
 * npm dist.integrity（`sha512-<base64>`，可多段空格分隔）校验；缺失时退 dist.shasum
 * （sha1 hex）。两者都没有 = 无法校验 = 不通过。
 */
export function verifyWecomArtifact(buf: Buffer, dist: Pick<WecomDist, 'integrity' | 'shasum'>): boolean {
  const integrity = (dist.integrity ?? '').trim();
  if (integrity) {
    return integrity.split(/\s+/).some((part) => {
      const sep = part.indexOf('-');
      if (sep <= 0) return false;
      const algo = part.slice(0, sep);
      if (algo !== 'sha512' && algo !== 'sha256' && algo !== 'sha1') return false;
      const expected = Buffer.from(part.slice(sep + 1), 'base64');
      const actual = expected.length > 0 ? digestOf(algo, buf) : null;
      return actual !== null && actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  }
  const shasum = (dist.shasum ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(shasum) && createHash('sha1').update(buf).digest('hex') === shasum;
}

/** `wecom-cli 1.3.4 (wecom 2026-09-23T11:47:44Z f9b2815)` */
export function parseWecomVersion(stdout: string): { version?: string; build?: string } {
  const text = stdout.trim();
  return {
    version: /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(text)?.[1],
    build: /\([^)\n]*\b([0-9a-f]{7,40})\)?\s*$/.exec(text)?.[1],
  };
}

/** auth show --status 的单行输出；其它内容按未知（null），不猜 */
export function parseWecomAuthStatus(stdout: string): boolean | null {
  const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim().toLowerCase();
  if (last === 'authorized') return true;
  if (last === 'unauthorized') return false;
  return null;
}

/** auth show（人类可读）：`Status: authorized` + `Bot ID: xxx` */
export function parseWecomAuthShow(stdout: string): { loggedIn: boolean | null; botId?: string } {
  const status = /^Status:\s*(\S+)/m.exec(stdout)?.[1]?.toLowerCase();
  const botId = /^Bot ID:\s*(\S+)/m.exec(stdout)?.[1];
  return {
    loggedIn: status === 'authorized' ? true : status === 'unauthorized' ? false : null,
    botId,
  };
}

export function parseWecomLoginOutput(text: string): { pageUrl?: string; qrSavedPath?: string; success: boolean } {
  const lines = text.split(/\r?\n/);
  const hint = lines.findIndex((l) => l.includes('请打开二维码链接扫码'));
  const pageUrl =
    lines
      .slice(hint + 1)
      .map((l) => l.trim())
      .find((l) => /^https?:\/\//.test(l));
  const saved = lines.find((l) => l.includes('二维码已保存到'));
  const qrSavedPath = saved?.replace(/^.*二维码已保存到[:：]\s*/, '').trim();
  return {
    ...(hint >= 0 && pageUrl ? { pageUrl } : {}),
    ...(qrSavedPath ? { qrSavedPath } : {}),
    success: /扫码成功/.test(text),
  };
}

interface WecomErrorShape {
  type?: unknown;
  code?: unknown;
  message?: unknown;
}

/** 输出尾部（混有提示文字时）的 `{error:{…}}`；多行美化 JSON 也认 */
function errorJsonOf(text: string): WecomErrorShape | null {
  let idx = text.lastIndexOf('{');
  while (idx >= 0) {
    const prev = idx === 0 ? '\n' : text[idx - 1];
    if (prev === '\n' || prev === '\r' || prev === ' ') {
      const slice = text.slice(idx);
      const end = slice.lastIndexOf('}');
      if (end > 0) {
        try {
          const parsed = JSON.parse(slice.slice(0, end + 1)) as { error?: WecomErrorShape };
          if (parsed?.error && typeof parsed.error === 'object') return parsed.error;
        } catch {
          /* 不是完整 JSON，继续往前找 */
        }
      }
    }
    idx = text.lastIndexOf('{', idx - 1);
  }
  return null;
}

/**
 * wecom-cli 失败输出 → 人话原因。业务错是 stdout 上的结构化 JSON
 * （`{error:{type,code,message}}`，退出码 1/2）；没有就退 stderr 尾行，兜底退出码。
 */
export function parseWecomError(result: Pick<CliRunResult, 'code' | 'stdout' | 'stderr'>): { message: string; auth: boolean } {
  const err = errorJsonOf(result.stdout);
  const message =
    typeof err?.message === 'string' && err.message.trim()
      ? err.message.trim().slice(0, 220)
      : '';
  if (message) {
    const type = typeof err?.type === 'string' ? err.type : '';
    const code = typeof err?.code === 'number' ? err.code : NaN;
    // 实测（1.3.4）：未授权调用业务接口时 type 是 UnknownError、code 是兜底的
    // 893999，鉴权信号只在 message 里（"AuthError: 该请求需要授权…[code=893201]"）
    const auth =
      type === 'AuthError' ||
      code === 893201 ||
      /AuthError|需要授权|unauthor|token expir|未授权|登录态?(?:已)?(?:失效|过期)/i.test(message);
    return { message, auth };
  }
  const tail = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return {
    message: tail ? tail.slice(0, 120) : `退出码 ${result.code}`,
    auth: false,
  };
}

/** PNG 完整性：文件头魔数 + IEND 块收尾（CLI 写文件非原子，半截文件不取） */
export function isCompletePng(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buf.lastIndexOf('IEND') === buf.length - 8;
}

/**
 * 从仓库归档里挑出官方技能文件。归档根目录是 wecom-cli-<sha>/，其下 skills/
 * 的每个子目录是一个技能；key = 相对 skills/ 的路径（wecomcli-calendar/SKILL.md）。
 */
export function selectWecomSkillEntries(entries: readonly TgzEntry[]): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const e of entries) {
    const slash = e.path.indexOf('/');
    if (slash < 0) continue;
    const rel = e.path.slice(slash + 1);
    if (!rel.startsWith('skills/')) continue;
    const skillPath = rel.slice('skills/'.length);
    if (/^wecomcli-[a-z0-9-]+\/.+$/.test(skillPath)) files.set(skillPath, e.data);
  }
  return files;
}

/** 技能内容指纹：按路径排序的「路径 + 文件 sha256」行再整体 sha256（与归档压缩参数无关） */
export function wecomSkillsDigest(files: ReadonlyMap<string, Buffer>): string {
  const lines = [...files.keys()]
    .sort()
    .map((p) => `${p}\n${createHash('sha256').update(files.get(p)!).digest('hex')}\n`);
  return createHash('sha256').update(lines.join('')).digest('hex');
}

export function listWecomSkills(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .filter((name) => name.startsWith('wecomcli-') && fs.existsSync(path.join(root, name, 'SKILL.md')))
      .sort();
  } catch {
    return [];
  }
}

/* ---------------- 路径与子进程 ---------------- */

function userHome(override?: string): string {
  if (override) return override;
  try {
    const { app } = requireElectron('electron') as typeof import('electron');
    return app.getPath('home') || os.homedir();
  } catch {
    return os.homedir();
  }
}

export function wecomLocalBinDir(home?: string): string {
  return path.join(userHome(home), '.local', 'bin');
}

export function wecomBinaryPath(home?: string): string {
  return path.join(wecomLocalBinDir(home), wecomBinaryName());
}

function userSkillsRoot(home?: string): string {
  return path.join(userHome(home), '.agents', 'skills');
}

/** 配置目录：WECOM_CLI_CONFIG_DIR（空串视为未设置）优先，否则 ~/.config/wecom（官方 config.rs） */
export function wecomConfigDir(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return env.WECOM_CLI_CONFIG_DIR?.trim() || path.join(userHome(home), '.config', 'wecom');
}

export interface WecomInvocation {
  command: string;
  args: string[];
}

/**
 * 解析可用的 wecom-cli 调用方式。探测用 --version（不联网、不需授权）。
 * 优先直启 exe 本体（PATH 上解析到的，或官方落点 ~/.local/bin/wecom-cli(.exe)）：
 * 取消/超时要杀得到 CLI 本体——经 cmd.exe 转发时只能杀掉 cmd，CLI 变孤儿。
 * PATH 上只有 npm 的 .cmd 垫片时才退回 cmd 转发。
 */
export async function resolveWecomCli(home?: string): Promise<WecomInvocation | null> {
  const local = wecomBinaryPath(home);
  const candidates: WecomInvocation[] = [];
  if (process.platform === 'win32') {
    const where = await runCliCommand('cmd.exe', ['/d', '/c', 'where', 'wecom-cli'], 10_000);
    // where 按 PATH 顺序逐行给候选，取第一个真实存在的 .exe
    const onPath = where.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\.exe$/i.test(l) && fs.existsSync(l));
    if (onPath) candidates.push({ command: onPath, args: [] });
  } else {
    candidates.push({ command: 'wecom-cli', args: [] });
  }
  if (fs.existsSync(local)) candidates.push({ command: local, args: [] });
  if (process.platform === 'win32') {
    // /d 禁 cmd AutoRun（doskey 宏回显会污染 stdout）
    candidates.push({ command: 'cmd.exe', args: ['/d', '/c', 'wecom-cli'] });
  }
  for (const cand of candidates) {
    const probe = await runCliCommand(cand.command, [...cand.args, '--version'], 20_000);
    if (probe.code === 0) return cand;
  }
  return null;
}

export function execWecom(cli: WecomInvocation, args: string[], timeoutMs: number): Promise<CliRunResult> {
  return runCliCommand(cli.command, [...cli.args, ...args], timeoutMs);
}

/** 下载到内存；流式计数，超过上限立即中止（不等整个正文落内存） */
async function fetchBytes(url: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('文件超过大小上限');
    if (!res.body) throw new Error('响应没有正文');
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error('文件超过大小上限');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error('下载超时');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 状态 ---------------- */

export async function getWecomStatus(home?: string): Promise<WecomStatusView> {
  const skills = listWecomSkills(userSkillsRoot(home));
  const cli = await resolveWecomCli(home);
  if (!cli) return { installed: false, loggedIn: false, skills };
  const [ver, show] = await Promise.all([
    execWecom(cli, ['--version'], 20_000),
    execWecom(cli, ['auth', 'show'], RUN_TIMEOUT_MS),
  ]);
  const info = parseWecomAuthShow(show.stdout);
  const loggedIn = info.loggedIn === true;
  return {
    installed: true,
    version: parseWecomVersion(ver.stdout).version,
    loggedIn,
    ...(loggedIn && info.botId ? { botId: info.botId } : {}),
    skills,
  };
}

/* ---------------- 安装 ---------------- */

/** 落盘：先写临时文件再换名。Windows 上运行中的 exe 不能覆盖但可以改名——旧的先挪走 */
function replaceBinary(target: string, data: Buffer): boolean {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, data, { mode: 0o755 });
  let backup: string | null = null;
  let replaced = false;
  if (fs.existsSync(target)) {
    backup = `${target}.old-${randomBytes(4).toString('hex')}`;
    fs.renameSync(target, backup);
    replaced = true;
  }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    if (backup) {
      try {
        fs.renameSync(backup, target);
      } catch {
        /* 回滚失败：原文件留在 backup 名下，错误照常上抛 */
      }
    }
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  if (backup) {
    try {
      fs.rmSync(backup, { force: true });
    } catch {
      /* 旧版本仍在运行（如登录中）：留着 .old- 文件无害，下次安装会再清 */
    }
  }
  return replaced;
}

export async function installWecomCli(
  source: WecomInstallSource,
  onOutput?: (chunk: string) => void,
  home?: string,
): Promise<WecomActionResult> {
  const log = (line: string): void => onOutput?.(`${line}\n`);
  const pkg = wecomPlatformPackage(process.platform, process.arch);
  if (!pkg) return { ok: false, output: `不支持的平台：${process.platform}-${process.arch}` };
  const registry = WECOM_REGISTRIES[source];
  try {
    const sourceName = source === 'mirror' ? '国内镜像' : 'npm 官方源';
    log(`正在获取 ${pkg} 的最新版本信息（${sourceName}）…`);
    const meta = JSON.parse((await fetchBytes(`${registry}/${pkg}`, MAX_META_BYTES, META_TIMEOUT_MS)).toString('utf8'));
    const dist = pickWecomDist(meta, registry, pkg);
    if (!dist) throw new Error('registry 元数据里没有可用版本');
    log(`正在下载 ${pkg}@${dist.version}…`);
    const tgz = await fetchBytes(dist.tarball, MAX_ARTIFACT_BYTES, DOWNLOAD_TIMEOUT_MS);
    if (!verifyWecomArtifact(tgz, dist)) throw new Error('下载内容与 registry 登记的校验值不一致，已放弃安装');
    const binName = wecomBinaryName();
    const entry = extractTgz(tgz).find((e) => e.path === `package/bin/${binName}`);
    if (!entry) throw new Error(`安装包里没有 ${binName}`);
    const target = wecomBinaryPath(home);
    const replaced = replaceBinary(target, entry.data);
    // 刚装好的目录可能还不在本进程 PATH 上（Agent 的 bash 靠 PATH 找命令）
    ensureUserLocalBinOnPath({ home });
    const probe = await runCliCommand(target, ['--version'], 20_000);
    const installed = parseWecomVersion(probe.stdout).version ?? dist.version;
    return {
      ok: probe.code === 0,
      output:
        probe.code === 0
          ? `安装成功：wecom-cli ${installed}${replaced ? '（旧版本已替换）' : ''}\n位置：${target}`
          : `已写入 ${target}，但运行 --version 失败（退出码 ${probe.code}）：${tailOf(probe.stderr, 300)}`,
    };
  } catch (err) {
    return { ok: false, output: `安装失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ---------------- 扫码登录 ---------------- */

interface WecomLoginSession {
  child: ChildProcess;
  startedAt: number;
  expiresAt: number;
  output: string;
  qrDir: string;
  qrDataUrl?: string;
  pageUrl?: string;
}

let loginSession: WecomLoginSession | null = null;
interface WecomLoginOutcome {
  state: 'succeeded' | 'expired' | 'failed';
  message: string;
  at: number;
}
let loginOutcome: WecomLoginOutcome | null = null;

/** 经函数读：settleLogin 在进程回调里改写模块级变量，函数体内的收窄看不到那次赋值 */
function peekLoginOutcome(): WecomLoginOutcome | null {
  return loginOutcome;
}

function settleLogin(session: WecomLoginSession, code: number | null): void {
  if (loginSession !== session) return; // 已被新一轮登录或取消顶替
  loginSession = null;
  fs.rmSync(session.qrDir, { recursive: true, force: true });
  const progress = parseWecomLoginOutput(session.output);
  if (code === 0 || progress.success) {
    loginOutcome = { state: 'succeeded', message: '', at: Date.now() };
    return;
  }
  const waited = Date.now() - session.startedAt;
  if (/QrTimeout|timed out|超时|过期/i.test(session.output) || waited >= WECOM_QR_WAIT_MS - 15_000) {
    loginOutcome = { state: 'expired', message: '二维码已过期（5 分钟内未扫码）', at: Date.now() };
    return;
  }
  loginOutcome = {
    state: 'failed',
    message: parseWecomError({ code: code ?? -1, stdout: session.output, stderr: '' }).message,
    at: Date.now(),
  };
}

/** 终止在途扫码（切换供应商 / 重新获取二维码 / 应用退出时）。杀整棵进程树。 */
export function cancelWecomLogin(): void {
  const session = loginSession;
  loginSession = null;
  if (!session) return;
  killProcessTree(session.child);
  fs.rmSync(session.qrDir, { recursive: true, force: true });
}

/** 面板轮询用的登录进行态；结果保留 10 分钟后不再报（避免一条过期提示常驻） */
export function getWecomLoginState(): OfficeLoginState | undefined {
  if (loginSession) {
    const s = loginSession;
    return {
      state: 'waiting',
      ...(s.qrDataUrl ? { qrDataUrl: s.qrDataUrl } : {}),
      ...(s.pageUrl ? { pageUrl: s.pageUrl } : {}),
      expiresAt: s.expiresAt,
    };
  }
  if (!loginOutcome || Date.now() - loginOutcome.at > LOGIN_OUTCOME_TTL_MS) return undefined;
  if (loginOutcome.state === 'succeeded') return { state: 'succeeded' };
  if (loginOutcome.state === 'expired') return { state: 'expired' };
  return { state: 'failed', message: loginOutcome.message };
}

/**
 * 后台跑扫码登录：不弹终端（打包环境 detached 控制台静默失败，0.2.24 的教训），
 * `--output-qrcode` 把二维码写成 PNG 取回面板展示；`--no-browser` 不抢前台。
 * 每次调用都是一次新的扫码（在途的旧进程先终止）——面板按钮在等待期间禁用，
 * 再次点击只可能是「重新获取二维码」。返回时二维码通常已就绪；登录完成由面板的
 * 5s 状态轮询发现（loggedIn 翻转）。
 */
export async function openWecomLogin(home?: string): Promise<WecomActionResult> {
  cancelWecomLogin();
  const cli = await resolveWecomCli(home);
  if (!cli) throw new Error('还没安装 wecom-cli');
  const qrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-wecom-qr-'));
  let child: ChildProcess;
  try {
    child = spawn(
      cli.command,
      [...cli.args, 'auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', path.join(qrDir, 'login.png')],
      { windowsHide: true },
    );
  } catch (err) {
    fs.rmSync(qrDir, { recursive: true, force: true });
    return { ok: false, output: `登录进程没起来：${err instanceof Error ? err.message : String(err)}` };
  }
  const session: WecomLoginSession = {
    child,
    startedAt: Date.now(),
    expiresAt: Date.now() + WECOM_QR_WAIT_MS,
    output: '',
    qrDir,
  };
  loginSession = session;
  loginOutcome = null;
  let spawnError: Error | null = null;
  child.stdout?.on('data', (d: Buffer) => {
    session.output += d.toString();
  });
  child.stderr?.on('data', (d: Buffer) => {
    session.output += d.toString();
  });
  child.on('error', (err) => {
    spawnError = err;
  });
  child.on('close', (code) => settleLogin(session, code));

  // 等二维码 PNG 写完整（CLI 写文件非原子：认魔数 + IEND 收尾）
  const qrPath = path.join(qrDir, 'login.png');
  const deadline = Date.now() + QR_READY_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    try {
      if (isCompletePng(fs.readFileSync(qrPath))) break;
    } catch {
      /* 还没写出来 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const progress = parseWecomLoginOutput(session.output);
  if (child.exitCode === null && !spawnError) {
    try {
      const png = fs.readFileSync(qrPath);
      if (isCompletePng(png)) session.qrDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      /* 没拿到图：仍可经授权链接扫码 */
    }
    session.pageUrl = progress.pageUrl;
    if (!session.qrDataUrl && !session.pageUrl) {
      cancelWecomLogin();
      return { ok: false, output: `没拿到二维码：${tailOf(session.output, 600) || 'CLI 没有输出'}` };
    }
    return {
      ok: true,
      output: '二维码已生成，请用企业微信扫一扫。',
      ...(session.pageUrl ? { url: session.pageUrl } : {}),
      ...(session.qrDataUrl ? { qrDataUrl: session.qrDataUrl } : {}),
    };
  }
  // 进程已经退出（网络失败等）
  const settled = peekLoginOutcome();
  const outcome = settled?.state === 'failed' ? settled.message : tailOf(session.output, 600);
  return { ok: false, output: `扫码登录没能启动：${outcome || `退出码 ${child.exitCode}`}` };
}

/**
 * 解除授权：wecom-cli 1.3.4 的 auth 只有 init/show，没有退出命令；官方存储层以
 * 删除 credentials.enc 表示清除（config.rs / store.rs）。只删这一个文件。
 */
export function runWecomLogout(home?: string): Promise<{ ok: boolean; output: string }> {
  cancelWecomLogin();
  const file = path.join(wecomConfigDir(process.env, home), 'credentials.enc');
  if (!fs.existsSync(file)) return Promise.resolve({ ok: true, output: '本机没有企业微信授权凭据。' });
  fs.rmSync(file);
  loginOutcome = null;
  return Promise.resolve({ ok: true, output: '已解除企业微信授权（删除本机凭据文件 credentials.enc）。' });
}

/* ---------------- 官方技能 ---------------- */

/**
 * 技能包钉在 CLI 1.3.4 的构建提交（--version 输出里的 git 提交号）。仓库不发 tag，
 * main 分支可能带着比已装 CLI 更新的未发布技能——跟着提交走才对得上版本。
 */
export const WECOM_SKILLS_COMMIT = 'f9b28151dc8d42f703db624fc9b26723c3c93fc5';
export const WECOM_SKILLS_FILE_COUNT = 123;
export const WECOM_SKILLS_DIR_COUNT = 15;
/** selectWecomSkillEntries + wecomSkillsDigest 在该提交归档上的值（2026-11-24 实算） */
export const WECOM_SKILLS_DIGEST = '3c38424c332b6ef328cdc8375e82add64e6681adf690b103dda2839c3fc8d905';

export function wecomSkillsArchiveUrl(
  source: 'mirror' | 'github',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const commit = WECOM_SKILLS_COMMIT;
  if (source === 'github') return `https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/${commit}`;
  // 与 tools/pi、tools/git 同一个镜像前缀约定（FUNDET_GH_PROXY，缺省 gh-proxy）
  const proxy = (env.FUNDET_GH_PROXY ?? 'https://gh-proxy.com/').replace(/\/?$/, '/');
  return `${proxy}https://github.com/WecomTeam/wecom-cli/archive/${commit}.tar.gz`;
}

/** 校验 + 落盘前的一切检查；返回按技能目录分组的文件（key = 技能目录名） */
export function groupWecomSkills(
  files: ReadonlyMap<string, Buffer>,
): Map<string, Map<string, Buffer>> {
  if (files.size !== WECOM_SKILLS_FILE_COUNT) {
    throw new Error(`技能包文件数不对（期望 ${WECOM_SKILLS_FILE_COUNT}，实际 ${files.size}）`);
  }
  const digest = wecomSkillsDigest(files);
  if (digest !== WECOM_SKILLS_DIGEST) throw new Error('技能包内容指纹不符（下载源可能被篡改或损坏），已放弃装配');
  const bySkill = new Map<string, Map<string, Buffer>>();
  for (const [p, data] of files) {
    const dir = p.slice(0, p.indexOf('/'));
    const bucket = bySkill.get(dir) ?? new Map<string, Buffer>();
    bucket.set(p.slice(dir.length + 1), data);
    bySkill.set(dir, bucket);
  }
  if (bySkill.size !== WECOM_SKILLS_DIR_COUNT) throw new Error(`技能目录数不对（期望 ${WECOM_SKILLS_DIR_COUNT}，实际 ${bySkill.size}）`);
  for (const [dir, bucket] of bySkill) {
    const skillMd = bucket.get('SKILL.md');
    if (!skillMd) throw new Error(`技能 ${dir} 缺少 SKILL.md`);
    validateSkillMarkdown(skillMd.toString('utf8'), dir);
  }
  return bySkill;
}

/** 一个技能目录原子落位：旧的先挪走再换新，失败回滚（skillhub 安装管线同款） */
function placeSkillDir(tmpRoot: string, root: string, dir: string): void {
  const target = path.join(root, dir);
  let backup: string | null = null;
  if (fs.existsSync(target)) {
    backup = `${target}.old-${randomBytes(4).toString('hex')}`;
    fs.renameSync(target, backup);
  }
  try {
    fs.renameSync(path.join(tmpRoot, dir), target);
  } catch (e) {
    if (backup) {
      try {
        fs.renameSync(backup, target);
      } catch {
        /* 回滚失败：原技能留在 backup 名下，错误照常上抛 */
      }
    }
    throw e;
  }
  if (backup) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 装配官方技能：下载 → 内存解包 → 文件数/指纹/ frontmatter 校验 → 落盘。
 *  镜像在前、GitHub 兜底；两个源的下载都要过同一道指纹。 */
export async function installWecomSkills(
  onOutput?: (chunk: string) => void,
  home?: string,
): Promise<WecomActionResult> {
  const log = (line: string): void => onOutput?.(`${line}\n`);
  const sources = ['mirror', 'github'] as const;
  let bySkill: Map<string, Map<string, Buffer>> | null = null;
  let lastError = '';
  for (const source of sources) {
    try {
      log(`正在下载官方技能包（${source === 'mirror' ? '国内镜像' : 'GitHub'}）…`);
      const archive = await fetchBytes(wecomSkillsArchiveUrl(source), MAX_ARCHIVE_BYTES, DOWNLOAD_TIMEOUT_MS);
      bySkill = groupWecomSkills(selectWecomSkillEntries(extractTgz(archive)));
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log(`该下载源失败：${lastError}`);
    }
  }
  if (!bySkill) return { ok: false, output: `官方技能装配失败：${lastError}` };

  const root = userSkillsRoot(home);
  const tmp = path.join(root, `.wecom-skills-tmp-${randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const [dir, bucket] of bySkill) {
      for (const [rel, data] of bucket) {
        const dest = path.join(tmp, dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
      }
    }
    for (const dir of bySkill.keys()) placeSkillDir(tmp, root, dir);
    return { ok: true, output: `已装配 ${bySkill.size} 个官方技能（wecomcli-*）到 ${root}` };
  } catch (err) {
    return { ok: false, output: `官方技能落盘失败：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
