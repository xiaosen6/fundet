/**
 * filePathPolicy —— 主进程文件读取的分层路径策略（对齐 Cindy filePathPolicy 的
 * deny-list 模型，本仓裁剪版）。
 *
 * 为什么预览用 deny-list 而非 allow-list（Cindy 权威注释同款理由）：
 * 合法的预览路径横跨全盘——agent 引用的任意绝对路径、用户粘贴的图片、
 * 从原始位置（~/Downloads、~/Desktop）预览的附件、任意盘的会话产物。
 * 「workDir 白名单」会把它们全拒。反过来：排除绝不该被渲染层读到的
 * 目录族（系统目录 / 凭据 / 浏览器 profile），其余放行。
 *
 * 两层：
 *  - 预览层（readFileDataUrl / readTextFile / fundet-file:// 协议）：
 *    系统 + 敏感目录黑名单，黑名单外全放行。
 *  - 附件层（stageFileIntoWorkDir / 发送路径）：维持既有 workDir 规则
 *    （界外必须 stage 进 .fundet-uploads，硬约束不变，见 fs-local.ts）。
 *
 * 纯模块：不 import Electron；realpath 可注入以便单测。
 */
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function pathFor(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Windows 系统目录（按环境变量构建，覆盖重装/迁盘场景） */
export function buildWin32SystemBlocklist(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [
    env.SystemRoot ?? 'C:\\Windows',
    env.ProgramFiles ?? 'C:\\Program Files',
    env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    env.ProgramData ?? 'C:\\ProgramData',
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** 用户级敏感目录（凭据/密钥/浏览器 profile；跨平台 HOME 下） */
const USER_SENSITIVE_DIRS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config/gcloud',
  '.config/gh',
  '.kube',
  '.docker',
];

/** 浏览器 profile 目录（AppData 下，Windows 常见） */
const WIN_BROWSER_PROFILE_DIRS = [
  'Google/Chrome/User Data',
  'Microsoft/Edge/User Data',
  'BraveSoftware/Brave-Browser/User Data',
  'Mozilla/Firefox',
];

export interface PreviewPathPolicyDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  realpathSync?: (p: string) => string;
}

/** 解析符号链接后的真实路径（失败回落原路径：不存在/无权限等交由后续 exists 检查） */
function realPath(p: string, realpathSync: (p: string) => string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isInsideOrEqual(rootDir: string, target: string, p: typeof path.posix): boolean {
  const rel = p.relative(p.resolve(rootDir), p.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/**
 * 预览路径守卫：命中黑名单（系统目录 / 凭据 / 浏览器 profile）抛错，其余放行。
 * 返回解析后的绝对路径。纯字符串 + realpath，不做存在性检查（调用方自检）。
 */
export function assertPreviewablePath(
  rawPath: string,
  deps: PreviewPathPolicyDeps = {},
): string {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const home = deps.homeDir ?? os.homedir();
  const realpathSync = deps.realpathSync ?? ((p: string) => fsSync.realpathSync(p));
  const p = pathFor(platform);

  const abs = path.isAbsolute(rawPath) ? p.resolve(rawPath) : p.resolve(process.cwd(), rawPath);
  const resolved = realPath(abs, realpathSync);

  // 1) Windows 系统目录
  if (platform === 'win32') {
    for (const dir of buildWin32SystemBlocklist(env)) {
      if (isInsideOrEqual(dir, resolved, p)) {
        throw new Error('系统目录不允许预览');
      }
    }
  } else {
    for (const dir of ['/etc', '/var/log', '/var/root', '/var/db', '/private/etc']) {
      if (isInsideOrEqual(dir, resolved, p)) {
        throw new Error('系统目录不允许预览');
      }
    }
  }

  // 2) 用户级敏感目录（HOME 下，双分隔符兼容）
  const norm = resolved.replace(/\\/g, '/');
  const homeNorm = home.replace(/\\/g, '/').replace(/\/$/, '');
  const sensitivePatterns = [...USER_SENSITIVE_DIRS, ...WIN_BROWSER_PROFILE_DIRS.map((d) => `AppData/Roaming/${d}`), ...WIN_BROWSER_PROFILE_DIRS.map((d) => `AppData/Local/${d}`)];
  for (const dir of sensitivePatterns) {
    const full = `${homeNorm}/${dir}`.toLowerCase();
    if (norm.toLowerCase().startsWith(full + '/') || norm.toLowerCase() === full) {
      throw new Error('敏感目录不允许预览（凭据 / 浏览器配置）');
    }
  }

  return resolved;
}

/**
 * 「用系统打开」（shell.openPath）的可执行类型闸：Windows shell 会直接执行
 * 这些扩展名的载荷——agent 产出的 .exe/.bat 出现在产物列表里被点开即运行。
 * 命中拒绝并给指引；文档/媒体类型不受影响。
 */
const SHELL_EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.ps1', '.psm1', '.psc1', '.msi', '.msp', '.mst',
  '.scr', '.cpl', '.msc', '.hta', '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsh',
  '.lnk', '.pif', '.jar', '.reg', '.chm', '.url',
]);

/** 会被系统 shell 执行（而非打开查看）的扩展名 → true */
export function isShellExecutablePath(filePath: string): boolean {
  const ext = path.win32.extname(filePath).toLowerCase() || path.extname(filePath).toLowerCase();
  return SHELL_EXECUTABLE_EXTENSIONS.has(ext);
}
