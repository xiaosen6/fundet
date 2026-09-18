/**
 * 发版冒烟脚本（§6 流程第 4 步的自动化，0.2.20 手工流程固化）：
 *   node tools/smoke-installer.mjs [安装包路径]（默认 dist 里版本最高的 exe）
 *
 * 步骤：拒绝在已有 Fundet 安装的机器跑（防污染真实安装）→ 静默装到临时目录
 * （/S /D= 必须反斜杠路径）→ 启动 → 轮询主窗口标题 ≠ "Error" → 杀树 →
 * 清理临时目录 + HKCU 卸载键 + **HKCU\Software\<guid> 安装目录记忆键** +
 * 开始菜单/桌面快捷方式（目录记忆键不清，用户下次安装的默认路径就变成
 * 冒烟临时路径——0.2.22 发布当天真踩过）。
 * 退出码 0 = 冒烟通过；非 0 带原因。
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ps = (script) => run('powershell', ['-NoProfile', '-Command', script]);

/** 枚举本机 Fundet 的卸载键 GUID（DisplayName 前缀匹配） */
async function fundetUninstallGuids() {
  const { stdout } = await ps(
    `(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'Fundet*' }).PSChildName`,
  );
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function resolveInstaller(arg) {
  if (arg) {
    if (!existsSync(arg)) throw new Error(`找不到安装包：${arg}`);
    return path.resolve(arg);
  }
  const dist = path.resolve(import.meta.dirname, '..', 'apps', 'desktop', 'dist');
  const exes = readdirSync(dist)
    .filter((f) => /^Fundet-Setup-.*-x64\.exe$/.test(f))
    .sort();
  if (exes.length === 0) throw new Error(`dist 里没有安装包：${dist}`);
  const latest = exes[exes.length - 1];
  return path.join(dist, latest);
}

const installer = resolveInstaller(process.argv[2]);
const smokeDir = `D:\\fundet-smoke-${Date.now()}`;
console.log(`[smoke] installer = ${installer}`);
console.log(`[smoke] target    = ${smokeDir}`);

// ⓪ 干净环境防呆：本机已有 Fundet 安装则拒绝（冒烟会覆盖其快捷方式/卸载键）
const preExisting = await fundetUninstallGuids();
if (preExisting.length > 0) {
  throw new Error(`本机已有 Fundet 安装（${preExisting.join(', ')}）：冒烟会污染它的注册表与快捷方式，请在干净环境跑`);
}

// ① 静默安装（NSIS /D= 反斜杠 + 不带引号）
await ps(`Start-Process -FilePath '${installer}' -ArgumentList '/S','/D=${smokeDir}' -Wait`);
const exe = path.join(smokeDir, 'Fundet.exe');
if (!existsSync(exe)) throw new Error('静默安装后找不到 Fundet.exe');
console.log('[smoke] install ok');

// ② 启动 + 轮询窗口标题（最长 30s）
await ps(`Start-Process -FilePath '${exe}'`);
let title = '';
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const { stdout } = await ps(
    `(Get-Process Fundet -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle`,
  );
  title = stdout.trim();
  if (title) break;
}
console.log(`[smoke] MainWindowTitle = "${title}"`);
const pass = title && title !== 'Error';
if (!pass) throw new Error(`冒烟失败：窗口标题异常（"${title}"）`);

// ③ 杀树
await ps(`Get-Process Fundet -ErrorAction SilentlyContinue | ForEach-Object { taskkill /PID $_.Id /T /F }`).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

// ④ 清理：HKCU 卸载键 + **HKCU\Software\<guid> 目录记忆键** + 快捷方式 + 临时目录
//    （目录记忆键不清 → 用户下次安装默认路径变成冒烟临时路径，0.2.22 真踩过）
const guids = await fundetUninstallGuids();
for (const guid of guids) {
  await ps(`Remove-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}' -Recurse -Force`)
    .then(() => console.log(`[smoke] removed uninstall key: ${guid}`))
    .catch(() => console.warn(`[smoke] 卸载键清理失败（可手清）：${guid}`));
  await ps(`if (Test-Path 'HKCU:\\Software\\${guid}') { Remove-Item -LiteralPath 'HKCU:\\Software\\${guid}' -Recurse -Force }`)
    .then(() => console.log(`[smoke] removed install-dir memory key: HKCU\\Software\\${guid}`))
    .catch(() => console.warn(`[smoke] 目录记忆键清理失败（可手清）：HKCU\\Software\\${guid}`));
}
for (const lnk of [
  `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Fundet.lnk`,
  `${process.env.USERPROFILE}\\Desktop\\Fundet.lnk`,
]) {
  if (existsSync(lnk)) {
    await ps(`Remove-Item -LiteralPath '${lnk}' -Force`);
    console.log(`[smoke] removed: ${lnk}`);
  }
}
rmSync(smokeDir, { recursive: true, force: true });
console.log('[smoke] PASS — 安装、启动、窗口标题、清理（含目录记忆键）全部通过');
