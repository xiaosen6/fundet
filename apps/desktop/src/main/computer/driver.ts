/**
 * cua-driver 二进制解析：电脑操作（Computer Use）的截屏/输入引擎
 * （trycua/cua 的 Rust 驱动，stdio MCP server，子命令 `mcp`）。
 * dev 从 apps/cua-driver-bin/<plat>/ 取（tools/cua-driver/update.mjs 下载），
 * 打包态从 resources/cua-driver/<plat>/ 取（extraResources + CI 下载步）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function resolveCuaDriverCommand(): string | null {
  const plat = process.platform === 'darwin' ? 'darwin-universal' : `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`;
  const binFile = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'cua-driver', plat, binFile)]
    : [
        path.resolve(app.getAppPath(), '..', 'cua-driver-bin', plat, binFile),
        path.resolve(app.getAppPath(), 'cua-driver-bin', plat, binFile),
      ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* 下一候选 */
    }
  }
  return null;
}

/** cua-driver 默认发送无内容产品遥测——本地优先产品 Explicitly 关掉。
 * fire-and-forget：绝不阻塞会话装配（同步等它会卡住 createSession）。 */
export function disableCuaDriverTelemetry(command: string): void {
  try {
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const child = spawn(command, ['telemetry', 'disable'], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('exit', () => clearTimeout(timer));
    child.on('error', () => clearTimeout(timer));
  } catch {
    /* 遥测开关失败不影响功能 */
  }
}
