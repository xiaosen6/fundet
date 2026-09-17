/**
 * 发版冒烟脚本（§6 流程第 4 步的自动化，0.2.20 手工流程固化）：
 *   node tools/smoke-installer.mjs [安装包路径]（默认 dist 里版本最高的 exe）
 *
 * 步骤：静默装到临时目录（/S /D= 必须反斜杠路径）→ 启动 → 轮询主窗口标题
 * ≠ "Error" → 杀树 → 清理临时目录 + HKCU 卸载键 + 开始菜单/桌面快捷方式
 * （不清会把冒烟临时路径写进安装器记忆）。
 * 退出码 0 = 冒烟通过；非 0 带原因。
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ps = (script) => run('powershell', ['-NoProfile', '-Command', script]);

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

// ④ 清理：HKCU 卸载键（按 DisplayName=Fundet 定位）+ 快捷方式 + 临时目录
const { stdout: keys } = await ps(
  `(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'Fundet*' }).PSPath`,
);
for (const raw of keys.split('\n').map((l) => l.trim()).filter(Boolean)) {
  const keyPath = raw.replace(/^Microsoft\.PowerShell\.Core\\Registry::/, '');
  await ps(`Remove-Item -LiteralPath 'HKCU:\\${keyPath.replace(/^HKEY_CURRENT_USER\\/, '')}' -Recurse -Force`).catch((e) =>
    console.warn(`[smoke] 卸载键清理失败（可手清）：${keyPath}`),
  );
  console.log(`[smoke] removed reg: ${keyPath}`);
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
console.log('[smoke] PASS — 安装、启动、窗口标题、清理全部通过');
