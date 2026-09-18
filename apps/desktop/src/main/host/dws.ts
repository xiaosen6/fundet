/**
 * 钉钉工作台（dws CLI）桥：探测 / 安装 / 登录引导 / 官方技能装配。
 *
 * dws = 钉钉官方开源 CLI（Apache-2.0，DingTalk-Real-AI/dingtalk-workspace-cli），
 * 以用户本人 OAuth 身份操作钉钉工作台（消息/日历/审批/待办/文档/AI表格等 180+ 命令）。
 * Fundet 不捆绑二进制、不做 API 代理，只负责四步引导：
 *   ① 安装（官方 install.ps1，默认 Gitee 镜像——本机实测 GitHub 直连常被重置）
 *   ② dws auth login（拉起可见 PowerShell 窗口，浏览器自动开）
 *   ③ dws skill setup（官方技能包平铺到 ~/.agents/skills/dingtalk-*，
 *      与本仓技能系统同目录，Pi 会话直接可用——核心零改动）
 *   ④ 状态探测（version / profile list 的 JSON 输出）
 * Agent 执行 dws 走普通 shell 命令，过既有命令确认闸；dws 官方技能自带
 * 「写操作先 --dry-run」纪律，双层确认叠加。
 *
 * electron 依赖全部惰性 require（node --test 导入纯解析函数不能拉起 electron）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { FUNDET_INVOKE } from '../ipc/channels.ts';

const requireElectron = createRequire(import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const SKILL_SETUP_TIMEOUT_MS = 5 * 60_000;

export type DwsInstallSource = 'gitee' | 'github';

export interface DwsProfileView {
  /** 稳定身份 corpId:userId（profile list 返回的 profile 字段） */
  id: string;
  org?: string;
  user?: string;
  isCurrent?: boolean;
}

export interface DwsStatusView {
  installed: boolean;
  version?: string;
  /** profile list 非空即视为已登录（未登录时 dws 返回空 profiles 数组） */
  loggedIn: boolean;
  profiles: DwsProfileView[];
  /** 已装配的 dingtalk-* 技能目录名（~/.agents/skills 下） */
  skills: string[];
}

export interface DwsActionResult {
  ok: boolean;
  /** 命令输出尾部（安装/装配日志可能很长，只留尾巴给面板展示） */
  output: string;
}

/* ---------------- 纯解析（单测覆盖） ---------------- */

export function parseDwsVersion(stdout: string): { version?: string; build?: string } {
  try {
    const j = JSON.parse(stdout) as { version?: unknown; build?: unknown };
    const out: { version?: string; build?: string } = {};
    if (typeof j.version === 'string') out.version = j.version;
    if (typeof j.build === 'string') out.build = j.build;
    return out;
  } catch {
    return {};
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

/** profile list 的 profiles[] 字段名随版本可能变化，宽容提取 + 稳定 id 兜底 */
export function parseProfileList(stdout: string): DwsProfileView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const arr = (parsed as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(arr)) return [];
  const out: DwsProfileView[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const view: DwsProfileView = {
      id: firstString(p.profile, p.id) ?? '',
      org: firstString(p.corpName, p.orgName, p.companyName),
      user: firstString(p.userName, p.nickName, p.name),
      isCurrent: p.isCurrent === true || p.isOrgCurrent === true,
    };
    if (view.id || view.org || view.user) out.push(view);
  }
  return out;
}

/** 用户级技能根下的 dingtalk-* 技能（dws 官方技能包的落点） */
export function listDingtalkSkills(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .filter(
        (name) =>
          name.startsWith('dingtalk-') && fs.existsSync(path.join(root, name, 'SKILL.md')),
      )
      .sort();
  } catch {
    return [];
  }
}

/* ---------------- 子进程执行 ---------------- */

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function tail(text: string, max = 3000): string {
  const t = text.trim();
  return t.length <= max ? t : `…${t.slice(-max)}`;
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  opts: { shell?: boolean; detached?: boolean; windowsHide?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        windowsHide: opts.windowsHide !== false,
        shell: opts.shell ?? false,
        detached: opts.detached ?? false,
      });
    } catch {
      resolve({ code: -1, stdout: '', stderr: 'spawn 失败' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve({ code: -1, stdout, stderr: `${stderr}\n超时（${Math.round(timeoutMs / 1000)}s）` });
      }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function userHome(): string {
  try {
    const { app } = requireElectron('electron') as typeof import('electron');
    return app.getPath('home') || os.homedir();
  } catch {
    return os.homedir();
  }
}

function userSkillsRoot(): string {
  return path.join(userHome(), '.agents', 'skills');
}

interface DwsInvocation {
  command: string;
  args: string[];
  /** PowerShell 里引用可执行文件的写法（路径含空格等） */
  psCommand: string;
}

/**
 * 解析可用的 dws 调用方式：PATH 优先；PATH 未刷新（刚安装完）时回退
 * 探测官方 install.ps1 的默认落点 ~/.local/bin/dws(.exe)。
 */
async function resolveDws(): Promise<DwsInvocation | null> {
  const home = userHome();
  const candidates: DwsInvocation[] =
    process.platform === 'win32'
      ? [
          { command: 'cmd.exe', args: ['/c', 'dws'], psCommand: 'dws' },
          {
            command: path.join(home, '.local', 'bin', 'dws.exe'),
            args: [],
            psCommand: `"${path.join(home, '.local', 'bin', 'dws.exe')}"`,
          },
        ]
      : [
          { command: 'dws', args: [], psCommand: 'dws' },
          {
            command: path.join(home, '.local', 'bin', 'dws'),
            args: [],
            psCommand: `"${path.join(home, '.local', 'bin', 'dws')}"`,
          },
        ];
  for (const cand of candidates) {
    if (cand.command !== 'dws' && cand.command !== 'cmd.exe' && !fs.existsSync(cand.command)) {
      continue;
    }
    const probe = await runCommand(cand.command, [...cand.args, 'version', '--format', 'json'], 20_000);
    if (probe.code === 0) return cand;
  }
  return null;
}

async function execDws(dws: DwsInvocation, args: string[], timeoutMs: number): Promise<RunResult> {
  return runCommand(dws.command, [...dws.args, ...args], timeoutMs);
}

/* ---------------- 面板动作 ---------------- */

export async function getDwsStatus(): Promise<DwsStatusView> {
  const skills = listDingtalkSkills(userSkillsRoot());
  const dws = await resolveDws();
  if (!dws) return { installed: false, loggedIn: false, profiles: [], skills };
  const [ver, prof] = await Promise.all([
    execDws(dws, ['version', '--format', 'json'], RUN_TIMEOUT_MS),
    execDws(dws, ['profile', 'list', '--format', 'json'], RUN_TIMEOUT_MS),
  ]);
  const profiles = parseProfileList(prof.stdout);
  return {
    installed: true,
    version: parseDwsVersion(ver.stdout).version,
    loggedIn: profiles.length > 0,
    profiles,
    skills,
  };
}

const INSTALL_SCRIPTS: Record<DwsInstallSource, string> = {
  gitee:
    "$env:DWS_GITEE_REPO='DingTalk-Real-AI/dingtalk-workspace-cli'; " +
      'irm https://gitee.com/DingTalk-Real-AI/dingtalk-workspace-cli/raw/main/scripts/install.ps1 | iex',
  github:
    'irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex',
};

/** 官方 install.ps1（装到 ~/.local/bin 并注册用户 PATH）。完成后无需重启应用即可探测。 */
export async function installDws(source: DwsInstallSource): Promise<DwsActionResult> {
  const res = await runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_SCRIPTS[source]],
    INSTALL_TIMEOUT_MS,
  );
  const output = tail(`${res.stdout}\n${res.stderr}`.trim());
  if (res.code !== 0) return { ok: false, output: output || '安装脚本退出码非 0' };
  const after = await resolveDws();
  return {
    ok: after !== null,
    output: after ? `${output}\n\n安装成功：dws ${after.psCommand === 'dws' ? '' : '(本地路径)'}已可用。` : `${output}\n\n脚本跑完但没探测到 dws——可能 PATH 未刷新，重启应用再试。`,
  };
}

/** 拉起可见 PowerShell 窗口跑 dws auth login（浏览器自动开；共创期无浏览器环境可改 --device）。 */
export async function openDwsLogin(): Promise<DwsActionResult> {
  const dws = await resolveDws();
  if (!dws) throw new Error('还没安装 dws');
  const script = `${dws.psCommand} auth login`;
  try {
    const child = spawn('powershell.exe', ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true, output: '已打开登录窗口（PowerShell）。浏览器会自动弹出钉钉授权页；登录后回到这里刷新状态。' };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

/** 装配官方技能包：平铺到 ~/.agents/skills/dingtalk-*（与本仓技能系统同目录）。 */
export async function runDwsSkillSetup(): Promise<DwsActionResult> {
  const dws = await resolveDws();
  if (!dws) throw new Error('还没安装 dws');
  const res = await execDws(dws, ['skill', 'setup', '--mode', 'multi', '--target', 'all', '--yes'], SKILL_SETUP_TIMEOUT_MS);
  const output = tail(`${res.stdout}\n${res.stderr}`.trim());
  return { ok: res.code === 0, output };
}

/* ---------------- IPC ---------------- */

export function registerDwsIpc(): void {
  const { ipcMain } = requireElectron('electron') as typeof import('electron');
  ipcMain.handle(FUNDET_INVOKE.DWS_STATUS, async () => getDwsStatus());
  ipcMain.handle(FUNDET_INVOKE.DWS_INSTALL, async (_e: unknown, source: unknown) =>
    installDws(source === 'github' ? 'github' : 'gitee'),
  );
  ipcMain.handle(FUNDET_INVOKE.DWS_LOGIN, async () => openDwsLogin());
  ipcMain.handle(FUNDET_INVOKE.DWS_SKILL_SETUP, async () => runDwsSkillSetup());
}
