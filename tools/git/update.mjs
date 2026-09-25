#!/usr/bin/env node
/**
 * 下载 Git for Windows PortableGit 并裁剪成随包 Git Bash（不安装、不改系统）。
 *
 * 用途：客户机没装 Git 时 pi 的 bash 工具与 checkpoint 快照全部失效（pi 只认
 * bash.exe；快照用 PATH 上的 git）。本脚本把便携版 Git Bash 准备到
 * apps/git-bin/win32-x64/，经 electron-builder extraResources 随安装包分发，
 * 主进程在「系统 Git 完全不可见」时才把它的 cmd/bin 前置进 PATH（见
 * src/main/host/git-bash.ts），用户自装的 Git 永远优先。
 *
 * 用法（仅 win32-x64，其它平台 bash/git 系统自带，无需准备）：
 *   node tools/git/update.mjs            # 按 latest.json pin 下载
 *   node tools/git/update.mjs --force    # 忽略本地缓存重下
 *
 * 网络：GitHub 直连常断，可用 FUNDET_GH_PROXY 前缀镜像，如
 *   FUNDET_GH_PROXY=https://gh-proxy.com/ node tools/git/update.mjs
 *
 * 校验 fail-closed：sha256 不符即删档退出（hash 为本仓自算固定值，
 * git-for-windows 官方不发布逐资产 digest）。
 *
 * 裁剪清单（351MB → ~273MB，压进安装包约 +75MB）：去 vim 全家 / perl 全家 /
 * mintty / mingw64 文档。保留全部 git-core、git-lfs、GCM（credential 弹窗）、
 * curl + CA、coreutils——裁剪后已实测 bash/git init+commit/ls-remote/curl/
 * tar/cmd 互操作全通过。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'latest.json'), 'utf8'));
const UPDATES_DIR = path.join(__dirname, 'updates');
const OUT_DIR = path.join(__dirname, '..', '..', 'apps', 'git-bin', 'win32-x64');

const PRUNE_DIRS = [
  'usr/share/vim',
  'usr/share/perl5',
  'usr/share/mintty',
  'usr/share/gtk-doc',
  'usr/lib/perl5',
  'usr/bin/core_perl',
  'usr/bin/vendor_perl',
  'mingw64/share/doc',
];
const PRUNE_FILES = [
  'usr/bin/ex.exe',
  'usr/bin/rview.exe',
  'usr/bin/rvim.exe',
  'usr/bin/view.exe',
  'usr/bin/vim.exe',
  'usr/bin/vimdiff.exe',
  'usr/bin/vimtutor',
  'usr/bin/vi',
  'usr/bin/perl.exe',
  'usr/bin/perl5.42.3.exe',
  'usr/bin/msys-perl5_42.dll',
  'usr/bin/msys-svn_swig_perl-1-0.dll',
  'usr/bin/mintty.exe',
];

function usage() {
  console.log('用法: node tools/git/update.mjs [--force]');
}

function parseArgs() {
  const force = process.argv.includes('--force');
  const bad = process.argv.slice(2).filter((a) => a !== '--force' && !a.startsWith('-'));
  if (bad.length > 0) {
    console.error(`未知参数: ${bad.join(' ')}`);
    usage();
    process.exit(2);
  }
  return { force };
}

function sha256File(file) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function assetUrl() {
  const prefix = process.env.FUNDET_GH_PROXY?.replace(/\/+$/, '') ?? '';
  if (prefix) return `${prefix}/${PIN.asset.url}`;
  return PIN.asset.url;
}

async function download(dest) {
  const url = assetUrl();
  console.log(`下载 ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 HTTP ${res.status}（直连常断可设 FUNDET_GH_PROXY=https://gh-proxy.com/）`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function extract(sfxPath, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // PortableGit 是 7zSD 自解压壳，支持 -o<目录> -y 静默解压
  const r = spawnSync(sfxPath, ['-o' + outDir, '-y'], {
    stdio: 'ignore',
    timeout: 10 * 60_000,
    windowsHide: true,
  });
  if (r.status !== 0 || !fs.existsSync(path.join(outDir, 'bin', 'bash.exe'))) {
    throw new Error(`自解压失败（exit=${r.status}），产物缺 bin/bash.exe`);
  }
}

function prune(root) {
  for (const rel of PRUNE_DIRS) {
    fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }
  for (const rel of PRUNE_FILES) {
    fs.rmSync(path.join(root, rel), { force: true });
  }
}

function dirSize(root) {
  let total = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function main() {
  const { force } = parseArgs();
  if (process.platform !== 'win32') {
    console.log('非 win32 平台无需 Git Bash（bash/git 系统自带），跳过。');
    return;
  }
  fs.mkdirSync(UPDATES_DIR, { recursive: true });

  const archive = path.join(UPDATES_DIR, PIN.asset.name);
  const versionFile = path.join(OUT_DIR, 'VERSION');
  const tgzPath = path.join(path.dirname(OUT_DIR), 'win32-x64-runtime.tar.gz');
  if (
    !force &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, 'utf8').trim() === PIN.version &&
    fs.existsSync(path.join(OUT_DIR, 'bin', 'bash.exe')) &&
    fs.existsSync(tgzPath)
  ) {
    console.log(`apps/git-bin/win32-x64 已是 ${PIN.version}（含 tar.gz），跳过（--force 重下）。`);
    return;
  }

  if (force || !fs.existsSync(archive) || sha256File(archive) !== PIN.asset.sha256) {
    if (fs.existsSync(archive)) {
      console.log('本地归档 sha256 不符或 --force，重新下载…');
      fs.rmSync(archive, { force: true });
    }
    void download(archive).then(() => {
      const got = sha256File(archive);
      if (got !== PIN.asset.sha256) {
        fs.rmSync(archive, { force: true });
        throw new Error(`sha256 不符: 期望 ${PIN.asset.sha256}，实得 ${got}，已删除归档。`);
      }
      build();
    }, (err) => {
      console.error(err.message);
      process.exit(1);
    });
  } else {
    build();
  }

  function build() {
    console.log('sha256 ok，解压…');
    const staging = path.join(UPDATES_DIR, 'staging');
    extract(archive, staging);
    console.log('裁剪 vim/perl/mintty/文档…');
    prune(staging);
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });
    fs.renameSync(staging, OUT_DIR);
    fs.writeFileSync(path.join(OUT_DIR, 'VERSION'), PIN.version + '\n');
    // 随包分发产物：单文件 tar.gz（安装期免 2500+ 文件的写盘+杀软扫描，
    // 首次启动由主进程解到 userData/runtime/git——见 host/git-bash.ts）
    const tgz = path.join(path.dirname(OUT_DIR), 'win32-x64-runtime.tar.gz');
    console.log('生成随包 tar.gz…');
    const r = spawnSync(
      process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar',
      ['-czf', tgz, '-C', OUT_DIR, '.'],
      { stdio: 'ignore', timeout: 10 * 60_000 },
    );
    if (r.status !== 0) throw new Error('tar.gz 生成失败 exit=' + r.status);
    console.log(
      `完成: apps/git-bin/win32-x64（${(dirSize(OUT_DIR) / 1024 / 1024).toFixed(0)}MB，版本 ${PIN.version}）` +
        ` + win32-x64-runtime.tar.gz（${(fs.statSync(tgz).size / 1024 / 1024).toFixed(0)}MB）`,
    );
  }
}

main();
