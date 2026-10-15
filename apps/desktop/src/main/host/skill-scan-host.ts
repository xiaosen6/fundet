/**
 * 技能扫描的 Electron 绑定点：utilityProcess.fork（env 白名单/cwd=tmpdir/
 * stdio ignore，Cindy #5858 同构）+ 惰性单例 + 退出回收。
 * fork 路径按 import.meta.url 定位构建产物（out/main/skill-scan-process.js，
 * electron-vite 多入口在 dev 与 build 都会产出，与 index.js 同目录）。
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utilityProcess } from 'electron';
import type { ListCustomizationsOptions, ListCustomizationsResult } from '@fundet/agent-core';
import { SkillScanClient, type SkillScanChild } from './skill-scan-client.js';

const ENV_WHITELIST = [
  'PATH', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE',
  'HOMEDRIVE', 'HOMEPATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
] as const;

/** 子进程只做目录扫描：凭证类环境变量绝不进入（白名单放行系统必需项） */
function whitelistEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

let client: SkillScanClient | null = null;

function getClient(): SkillScanClient {
  if (!client) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    client = new SkillScanClient({
      fork: (): SkillScanChild =>
        utilityProcess.fork(path.join(here, 'skill-scan-process.js'), [], {
          serviceName: 'fundet-skill-scan',
          env: whitelistEnv(),
          cwd: os.tmpdir(),
          stdio: 'ignore',
        }) as unknown as SkillScanChild,
    });
  }
  return client;
}

/** 技能目录扫描（隔离执行）：skills.ts 的 listSkills 经此调用 */
export function scanPiSkills(options: ListCustomizationsOptions): Promise<ListCustomizationsResult> {
  return getClient().scan(options);
}

/** 退出前回收在途扫描与子进程（幂等；index.ts before-quit 挂接） */
export function disposeSkillScanHost(): void {
  client?.dispose();
  client = null;
}
