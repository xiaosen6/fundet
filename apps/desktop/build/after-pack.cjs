/**
 * electron-builder afterPack 钩子（Windows）：给 Fundet.exe 嵌图标与版本资源。
 *
 * 背景：0.3.14 为根治 EBUSY 关了 win.signAndEditExecutable——但它同时负责
 * rcedit 嵌图标，关掉后任务栏变灰（0.3.16 修复）。本钩子只处理主 exe 一个
 * 文件（秒级、无 signtool 全目录风暴），EBUSY 竞态面归零。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findRcedit() {
  // pnpm 工作区：electron-winstaller 是根 devDeps 的传递依赖，其 .pnpm 库在仓库根
  const roots = [
    path.resolve(__dirname, '..', '..', '..'), // 仓库根
    path.resolve(__dirname, '..', '..'), // apps/desktop（兜底）
  ];
  for (const base of roots) {
    for (const nm of [path.join(base, 'node_modules'), base]) {
      const pnpmDir = path.join(nm, '.pnpm');
      let pkgs;
      try {
        pkgs = fs.readdirSync(pnpmDir);
      } catch {
        continue;
      }
      for (const p of pkgs) {
        const vend = path.join(pnpmDir, p, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
        if (fs.existsSync(vend)) return vend;
      }
    }
  }
  return null;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, 'Fundet.exe');
  if (!fs.existsSync(exe)) throw new Error('afterPack: Fundet.exe 不存在 ' + exe);
  const rcedit = findRcedit();
  if (!rcedit) throw new Error('afterPack: 找不到 rcedit.exe（electron-winstaller vendor）');
  const icon = path.resolve(__dirname, '..', 'resources', 'fundet', 'icon.ico');
  const version = context.packager?.appInfo?.version ?? require('../package.json').version;
  // cua-driver：带重试拷贝（Defender 对截屏/输入钩子 DLL 的新鲜拷贝有秒级扫描
  // 锁窗，eb 裸 copyfile 无重试、曾四连 EBUSY——挪到这里自管，每文件最长等 90s）
  const srcDir = path.resolve(__dirname, '..', '..', '..', 'apps', 'cua-driver-bin', 'win32-x64');
  const dstDir = path.join(context.appOutDir, 'resources', 'cua-driver', 'win32-x64');
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(dstDir, f);
    let ok = false;
    for (let i = 0; i < 45 && !ok; i++) {
      try {
        fs.copyFileSync(src, dst);
        ok = true;
      } catch {
        fs.rmSync(dst, { force: true });
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)'], { timeout: 4000, stdio: 'ignore' });
      }
    }
    if (!ok) throw new Error(`afterPack: cua-driver/${f} 拷贝重试 90s 仍被锁（杀软扫描未放行）`);
  }
  console.log(`  ⨯ afterPack: cua-driver 已拷贝（带重试）`);
  const args = [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', 'Fundet',
    '--set-version-string', 'FileDescription', 'Fundet',
    '--set-version-string', 'FileVersion', version,
    '--set-version-string', 'ProductVersion', version,
  ];
  const r = spawnSync(rcedit, args, { stdio: 'pipe', timeout: 30_000 });
  if (r.status !== 0) {
    throw new Error('afterPack: rcedit 失败 exit=' + r.status + ' ' + String(r.stderr).slice(0, 200));
  }
  console.log(`  ⨯ afterPack: Fundet.exe 图标与版本资源已嵌入（v${version}）`);
}

module.exports = afterPack;
module.exports.default = afterPack;
