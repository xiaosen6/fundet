/**
 * 打平浏览器运行时的 node_modules 闭包 → apps/desktop/resources-browser/node_modules。
 *
 * 背景：electron-builder(26) + pnpm 的依赖收集器遇到 express 依赖树会死循环
 * （实测 express@4/@5 单独出现即卡死；@modelcontextprotocol/sdk 依赖 express）。
 * 因此桌面 package.json 不声明这些运行时依赖，改为把闭包打平成真实文件放进
 * resources/node_modules（asar 外、Electron 主进程模块解析会向上走到这里），
 * electron-builder 的收集器完全不见这棵树。
 *
 * 闭包起点 = packages/browser-runtime 的 8 个运行时依赖（其 devDependencies 里
 * 以符号链接存在），沿 .pnpm 的兄弟符号链接递归（dependencies + optionalDependencies，
 * 平台可选包缺失时跳过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNTIME_PKG_DIR = path.join(ROOT, 'packages', 'browser-runtime');
const OUT = path.join(ROOT, 'apps', 'desktop', 'resources-browser', 'node_modules');

const SEEDS = [
  'playwright-core',
  'sharp',
  'ws',
  'undici',
  'ipaddr.js',
  'typebox',
  'zod',
  '@modelcontextprotocol/sdk',
  // 可选运行时（软加载，装了才带）
  'tar',
  'jszip',
];

function resolveFrom(dir, name) {
  const candidate = path.join(dir, 'node_modules', name);
  if (!fs.existsSync(candidate)) return null;
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function pkgMeta(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function copyPkg(pkgDir, name) {
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(pkgDir, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(pkgDir, src);
      // 包内自带的 node_modules（符号链接）不拷：闭包已打平到顶层
      return rel !== 'node_modules' && !rel.startsWith(`node_modules${path.sep}`) && rel !== '.bin';
    },
  });
  console.log('  +', name);
}

const seen = new Set();
const queue = [];

for (const name of SEEDS) {
  const real = resolveFrom(RUNTIME_PKG_DIR, name);
  if (!real) {
    console.log(name, '不在本机依赖里（可选依赖未装？）——跳过');
    continue;
  }
  queue.push([name, real]);
}

while (queue.length > 0) {
  const [name, real] = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  copyPkg(real, name);
  const meta = pkgMeta(real);
  if (!meta) continue;
  const deps = { ...(meta.dependencies ?? {}), ...(meta.optionalDependencies ?? {}) };
  // .pnpm 布局：pkgDir = .pnpm/<pkg>@<v>/node_modules/<name>（scoped 包多一层
  // @scope 目录），依赖符号链接与 <name> 同级 —— 即 pkgDir 去掉包名部分
  const siblingRoot = real.slice(0, real.length - name.length - 1);
  for (const dep of Object.keys(deps)) {
    if (seen.has(dep)) continue;
    const depCandidate = path.join(siblingRoot, dep);
    if (!fs.existsSync(depCandidate)) continue; // 平台可选包未装等
    let depReal;
    try {
      depReal = fs.realpathSync(depCandidate);
    } catch {
      continue;
    }
    queue.push([dep, depReal]);
  }
}

// sharp 的平台二进制包（@img/sharp-<plat>-<arch>、@img/sharp-libvips-<...>）
// 是 optionalDependencies，pnpm 不在任何 node_modules 里建符号链接（只在
// .pnpm store 落盘）；sharp 0.33+ 运行时 require('@img/...')，必须显式打平。
// 本机装了哪个平台就拷哪个（CI mac runner 自然带 darwin 对）。
const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmDir)) {
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('@img+sharp-')) continue;
    // entry 形如 @img+sharp-win32-x64@0.35.4
    const at = entry.lastIndexOf('@');
    const pkgName = `@img/${entry.slice('@img+'.length, at)}`;
    const src = path.join(pnpmDir, entry, 'node_modules', pkgName);
    if (fs.existsSync(src)) {
      copyPkg(src, pkgName);
    }
  }
}

// @fundet/browser-runtime 本体：dist + 精简 package.json
const selfDir = path.join(OUT, '@fundet', 'browser-runtime');
fs.rmSync(selfDir, { recursive: true, force: true });
fs.mkdirSync(selfDir, { recursive: true });
fs.cpSync(path.join(RUNTIME_PKG_DIR, 'dist'), path.join(selfDir, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(selfDir, 'package.json'),
  JSON.stringify(
    {
      name: '@fundet/browser-runtime',
      version: '0.0.0',
      private: true,
      type: 'module',
      main: './dist/index.js',
      exports: {
        '.': './dist/index.js',
        './ssrf-runtime': './dist/shim/ssrf-runtime.js',
      },
    },
    null,
    2,
  ),
);
console.log('  + @fundet/browser-runtime (dist)');
console.log(`完成：${seen.size + 1} 个包 → ${path.relative(ROOT, OUT)}`);

// ---- 0.3.14 安装提速第三刀：单文件 tar.gz 随包（安装期免 ~5000 文件写盘/杀软
// 扫描），首启由主进程解回 resources/node_modules（ESM 向上解析原样命中，见
// host/runtime-extract.ts）。目录保留给本地排查，extraResources 只带 tgz。
const TGZ = path.join(path.dirname(OUT), 'browser-runtime.tar.gz');
const VERSION_FILE = path.join(path.dirname(OUT), 'BROWSER_RUNTIME_VERSION');
// 注意：fs.existsSync 判定用正斜杠写法（heredoc 反斜杠被吞的历史坑）
const tarBin = process.platform === 'win32' && fs.existsSync('C:/Windows/System32/tar.exe')
  ? 'C:/Windows/System32/tar.exe'
  : 'tar';
// bsdtar 经 node spawn 时反斜杠参数路径 exit=2——参数一律转正斜杠
const posix = (p) => p.replace(/\\/g, '/');
fs.rmSync(TGZ, { force: true });
const tar = spawnSync(tarBin, ['-czf', posix(TGZ), '-C', posix(OUT), '.'], { stdio: 'ignore', timeout: 600_000 });
if (tar.status !== 0) {
  console.error('browser-runtime.tar.gz 生成失败 exit=' + tar.status);
  process.exit(1);
}
fs.writeFileSync(VERSION_FILE, String(Date.now()) + '\n');
console.log(
  `tar.gz: ${path.relative(ROOT, TGZ)}（${(fs.statSync(TGZ).size / 1048576).toFixed(1)}MB）`,
);
