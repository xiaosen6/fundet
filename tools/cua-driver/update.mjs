#!/usr/bin/env node
/**
 * 下载 cua-driver（trycua/cua 的 Rust 驱动，MIT）到 apps/cua-driver-bin/<plat>/。
 * 电脑操作（Computer Use）功能的截屏/输入引擎。tag 前缀 cua-driver-rs-v，
 * asset 形如 cua-driver-rs-<ver>-windows-x86_64.zip / -darwin-universal.tar.gz。
 *
 * Usage:
 *   node tools/cua-driver/update.mjs                 # 最新版
 *   node tools/cua-driver/update.mjs 0.9.1
 *   node tools/cua-driver/update.mjs --platform=win32-x64
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MATCHING_REFS_URL =
  'https://api.github.com/repos/trycua/cua/git/matching-refs/tags/cua-driver-rs-v';
const UPDATES_DIR = path.join(__dirname, 'updates');
const BIN_ROOT = path.join(PROJECT_ROOT, 'apps', 'cua-driver-bin');

const PLATFORMS = {
  'win32-x64': { asset: (v) => `cua-driver-rs-${v}-windows-x86_64.zip`, binFile: 'cua-driver.exe', archive: 'zip' },
  'darwin-universal': { asset: (v) => `cua-driver-rs-${v}-darwin-universal.tar.gz`, binFile: 'cua-driver', archive: 'tar.gz' },
  'linux-x64': { asset: (v) => `cua-driver-rs-${v}-linux-x86_64-binary.tar.gz`, binFile: 'cua-driver', archive: 'tar.gz' },
};

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchCandidateVersions() {
  const res = await fetch(MATCHING_REFS_URL, {
    headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`matching-refs HTTP ${res.status}`);
  const refs = await res.json();
  const versions = refs
    .map((r) => /^refs\/tags\/cua-driver-rs-v(.+)$/.exec(r.ref)?.[1])
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (versions.length === 0) throw new Error('未找到 cua-driver-rs-v* tag');
  return versions;
}

async function download(platformKey, version) {
  const p = PLATFORMS[platformKey];
  if (!p) throw new Error(`未知平台 ${platformKey}（支持 ${Object.keys(PLATFORMS).join(' / ')}）`);
  const tag = `cua-driver-rs-v${version}`;
  const asset = p.asset(version);
  const url = `https://github.com/trycua/cua/releases/download/${tag}/${asset}`;
  const destDir = path.join(BIN_ROOT, platformKey);
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  const archivePath = path.join(UPDATES_DIR, asset);
  console.log(`下载 ${url}`);
  const res = await fetch(url, {
    headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(archivePath));

  fs.mkdirSync(destDir, { recursive: true });
  if (p.archive === 'zip') {
    // Windows 自带 tar.exe 支持 zip
    await new Promise((resolve, reject) => {
      const t = spawn('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' });
      t.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`tar exit ${c}`))));
      t.on('error', reject);
    });
  } else {
    await new Promise((resolve, reject) => {
      const t = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' });
      t.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`tar exit ${c}`))));
      t.on('error', reject);
    });
  }
  // 归一：zip/tar 常含单一顶层目录，把其内容全部提升到平台目录根
  // （driver 运行时按相对路径找 cua-driver-uia.exe / cua_driver_sdk.dll 等伴生文件）
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && entries.length === 1) {
    const inner = path.join(destDir, dirs[0].name);
    for (const e of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, e), path.join(destDir, e));
    }
    fs.rmdirSync(inner);
  }
  if (!fs.existsSync(path.join(destDir, p.binFile))) {
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error(`解包归一后未找到 ${p.binFile}`);
  }
  fs.writeFileSync(path.join(destDir, 'VERSION'), version);
  console.log(`✓ ${platformKey} cua-driver v${version} → ${path.join(destDir, p.binFile)}`);
}

async function main() {
  const version = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2].replace(/^v/, '')
    : null;
  const platformArg = argValue('--platform');
  const targets = platformArg ? [platformArg] : [`${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`];
  // macOS 用 universal 包
  const final = process.platform === 'darwin' ? ['darwin-universal'] : targets;
  if (version) {
    await download(final[0], version);
    for (const t of final.slice(1)) await download(t, version);
    return;
  }
  // 自动选版：tag 存在不代表 release 资产还在（上游删过 v0.23.1 的 release
  // 却留着 tag），从新到旧逐个试下载，首个全平台成功的版本即用。
  let lastErr;
  for (const v of await fetchCandidateVersions()) {
    try {
      for (const t of final) await download(t, v);
      return;
    } catch (err) {
      lastErr = err;
      console.log(`v${v} 下载失败（${err instanceof Error ? err.message : err}），尝试更旧版本…`);
    }
  }
  throw lastErr ?? new Error('无可用 cua-driver 版本');
}

main().then(
  () => process.exit(0), // fetch 的 keep-alive socket 会挂住 event loop，显式退出
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
