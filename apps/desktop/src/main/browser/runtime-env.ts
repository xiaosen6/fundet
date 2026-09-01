/**
 * 副作用模块：在 @fundet/browser-runtime 被 import 之前种下 XDT_BROWSER_RUNTIME_DIR。
 *
 * runtime 在模块求值期把这个 env 读成 eager 常量（CONFIG_DIR），晚了就回落到
 * 自身默认目录。种在 Electron userData 下（卸载即清理），登录态/Cookie 也在里面。
 * main/index.ts 把本文件列为第一条 import；app 在非 Electron 上下文（单测）为
 * undefined 时跳过，runtime 走自身默认目录（无害，那种上下文不会启动浏览器）。
 */
import path from 'node:path';
import { app } from 'electron';

const electronApp = app as { getPath?: (name: string) => string } | undefined;
if (!process.env.XDT_BROWSER_RUNTIME_DIR && electronApp?.getPath) {
  process.env.XDT_BROWSER_RUNTIME_DIR = path.join(
    electronApp.getPath('userData'),
    'browser-runtime',
  );
}
