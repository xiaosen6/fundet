/**
 * 本机技能导入 / 列表 / 卸载。
 * 落盘口径对齐 Cindy/Pi：用户级 ~/.agents/skills/<name>/ ，项目级 <workDir>/.agents/skills/<name>/。
 * 安装包自带的技能在 resources/bundled-skills/，启动时同步到用户技能目录（本仓当前不预装，目录缺省时静默跳过）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { parseFrontmatter, scanPiCustomizations } from '@fundet/agent-core';
import { parseSkillMarkdown } from './skill-package.js';
import { extractZip, findEntryInExtract } from './zip-extract.js';
import { brand } from '../../shared/brand.js';

/** 不用点开头：electron-builder extraResources 可能丢掉 dotfile */
const BUNDLED_MARKER = 'LONGMA_REVISION';
const LEGACY_BUNDLED_MARKER = '.longma-revision';

export interface SkillView {
  name: string;
  description: string;
  scope: 'user' | 'repo';
  path: string;
  workDir?: string;
  /** 安装包预置，设置页不可卸载 */
  bundled?: boolean;
  /** false = 已停用（目录在 skills.disabled/ 下，pi 不扫描、新会话不加载） */
  enabled?: boolean;
}

export function userSkillsRoot(): string {
  const home = (() => {
    try {
      return app.getPath('home');
    } catch {
      return os.homedir();
    }
  })();
  return path.join(home, '.agents', 'skills');
}

export function projectSkillsRoot(workDir: string): string {
  return path.join(path.resolve(workDir), '.agents', 'skills');
}

/** 停用技能的停放根：与 skills/ 同级（pi 只扫 skills/，挪出来即对会话隐形） */
export function userSkillsDisabledRoot(): string {
  const home = (() => {
    try {
      return app.getPath('home');
    } catch {
      return os.homedir();
    }
  })();
  return path.join(home, '.agents', 'skills.disabled');
}

export function projectSkillsDisabledRoot(workDir: string): string {
  return path.join(path.resolve(workDir), '.agents', 'skills.disabled');
}

function isBundledSkillDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, BUNDLED_MARKER)) ||
    fs.existsSync(path.join(dir, LEGACY_BUNDLED_MARKER))
  );
}

function readSkillMeta(dir: string, fallbackName: string): { name: string; description: string } {
  const md = path.join(dir, 'SKILL.md');
  try {
    const { frontmatter, description } = parseFrontmatter(fs.readFileSync(md, 'utf-8'));
    const named = typeof frontmatter?.name === 'string' ? frontmatter.name.trim() : '';
    return {
      name: named || fallbackName,
      description: description ?? '',
    };
  } catch {
    return { name: fallbackName, description: '' };
  }
}

function listBundledSkillViews(): SkillView[] {
  const root = bundledSkillsRoot();
  if (!root || !fs.existsSync(root)) return [];
  const destRoot = userSkillsRoot();
  const out: SkillView[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const src = path.join(root, ent.name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) continue;
    const installed = path.join(destRoot, ent.name);
    const meta = readSkillMeta(fs.existsSync(installed) ? installed : src, ent.name);
    out.push({
      name: meta.name,
      description: meta.description,
      scope: 'user',
      path: fs.existsSync(installed) ? installed : src,
      bundled: true,
    });
  }
  return out;
}

export async function listSkills(workDir?: string): Promise<SkillView[]> {
  const dirs = workDir && workDir.trim() ? [workDir.trim()] : [];
  const { items } = await scanPiCustomizations({ workingDirs: dirs, kinds: ['skill'] });
  const scanned: SkillView[] = items
    .filter((it) => it.kind === 'skill')
    .map((it) => ({
      name: it.name,
      description: it.description ?? '',
      scope: it.scope === 'repo' ? 'repo' : 'user',
      path: it.absolutePath,
      ...(it.workingDir ? { workDir: it.workingDir } : {}),
      ...(isBundledSkillDir(it.absolutePath) ? { bundled: true } : {}),
    }));

  const bundled = listBundledSkillViews();
  const byKey = new Map<string, SkillView>();
  for (const s of scanned) byKey.set(s.name.toLowerCase(), { ...s, enabled: true });
  for (const s of bundled) {
    const prev = byKey.get(s.name.toLowerCase());
    byKey.set(s.name.toLowerCase(), prev ? { ...prev, ...s, path: prev.path, bundled: true } : s);
  }
  // 停用技能：目录被挪到 skills.disabled/ 下的，列表里以 enabled:false 呈现
  const disabledRoots = [userSkillsDisabledRoot()];
  if (workDir && workDir.trim()) disabledRoots.push(projectSkillsDisabledRoot(workDir.trim()));
  for (const root of disabledRoots) {
    if (!fs.existsSync(root)) continue;
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || !fs.existsSync(path.join(root, ent.name, 'SKILL.md'))) continue;
      const meta = readSkillMeta(path.join(root, ent.name), ent.name);
      const key = meta.name.toLowerCase();
      const prev = byKey.get(key);
      if (prev?.enabled !== false) {
        byKey.set(key, {
          name: meta.name,
          description: meta.description,
          scope: root === disabledRoots[0] ? 'user' : 'repo',
          path: path.join(root, ent.name),
          enabled: false,
          ...(root !== disabledRoots[0] && workDir ? { workDir: path.resolve(workDir.trim()) } : {}),
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.bundled !== b.bundled) return a.bundled ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
}

function bundledSkillsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.resourcesPath || '', 'bundled-skills'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'bundled-skills'),
    path.join(app.getAppPath(), 'resources', 'bundled-skills'),
    path.resolve(here, '../../resources/bundled-skills'),
    path.resolve(here, '../../../resources/bundled-skills'),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return candidates[0] ?? '';
}

/** 把安装包内预制技能同步到 ~/.agents/skills。同名目录一律按内置覆盖。 */
export function ensureBundledSkills(): void {
  const srcRoot = bundledSkillsRoot();
  if (!srcRoot || !fs.existsSync(srcRoot)) {
    console.warn('[longma:skills] 找不到预制技能目录', { srcRoot, packaged: app.isPackaged });
    return;
  }
  const destRoot = userSkillsRoot();
  fs.mkdirSync(destRoot, { recursive: true });

  let count = 0;
  for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const src = path.join(srcRoot, ent.name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) continue;
    const dest = path.join(destRoot, ent.name);
    const srcRev = readRevision(src) ?? '1';
    const destRev = fs.existsSync(dest) ? readRevision(dest) : null;
    if (destRev && destRev === srcRev && fs.existsSync(path.join(dest, 'SKILL.md'))) {
      count += 1;
      continue;
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    copyDir(src, dest);
    fs.writeFileSync(path.join(dest, BUNDLED_MARKER), `${srcRev}\n`, 'utf-8');
    count += 1;
    console.log(`[longma:skills] 已预置技能 ${ent.name} → ${dest}`);
  }
  console.log(`[longma:skills] 预制技能就绪 ${count} 个`, { srcRoot, destRoot });
}

function readRevision(dir: string): string | null {
  for (const name of [BUNDLED_MARKER, LEGACY_BUNDLED_MARKER]) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf-8').trim();
      if (raw) return raw;
    } catch {
      // try next
    }
  }
  return null;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.' || ent.name === '..') continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) throw new Error(`不允许复制符号链接: ${from}`);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function installFolder(srcDir: string, destRoot: string, name: string): string {
  const dest = path.join(destRoot, name);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyDir(srcDir, dest);
  return dest;
}

export function importSkillFile(
  filePath: string,
  scope: 'user' | 'project',
  workDir?: string,
): SkillView {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const destRoot =
    scope === 'user'
      ? userSkillsRoot()
      : projectSkillsRoot(workDir && workDir.trim() ? workDir.trim() : '');
  if (scope === 'project' && !workDir?.trim()) {
    throw new Error('导入到项目需要提供工作目录');
  }
  fs.mkdirSync(destRoot, { recursive: true });

  const ext = path.extname(abs).toLowerCase();
  if (ext === '.zip') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-skill-'));
    try {
      extractZip(abs, tmp);
      const md = findEntryInExtract(tmp, 'SKILL.md') ?? findEntryInExtract(tmp, 'skill.md');
      if (!md) throw new Error('zip 内找不到 SKILL.md');
      const raw = fs.readFileSync(md, 'utf-8');
      const meta = parseSkillMarkdown(raw, path.basename(path.dirname(md)));
      const folder = path.dirname(md);
      const dest = installFolder(folder, destRoot, meta.name);
      return {
        name: meta.name,
        description: meta.description,
        scope: scope === 'user' ? 'user' : 'repo',
        path: dest,
        ...(scope === 'project' ? { workDir: path.resolve(workDir!) } : {}),
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const base = path.basename(abs).toLowerCase();
  if (base !== 'skill.md') {
    throw new Error('请选择 SKILL.md 或包含 SKILL.md 的 .zip');
  }
  const raw = fs.readFileSync(abs, 'utf-8');
  const meta = parseSkillMarkdown(raw, path.basename(abs, path.extname(abs)));
  const dest = path.join(destRoot, meta.name);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(abs, path.join(dest, 'SKILL.md'));
  return {
    name: meta.name,
    description: meta.description,
    scope: scope === 'user' ? 'user' : 'repo',
    path: dest,
    ...(scope === 'project' ? { workDir: path.resolve(workDir!) } : {}),
  };
}

function isManagedSkillDir(dir: string): boolean {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  const parentName = path.basename(parent);
  const userRoot = path.resolve(userSkillsRoot());
  const userDisabledRoot = path.resolve(userSkillsDisabledRoot());
  if (resolved.startsWith(userRoot + path.sep) || resolved.startsWith(userDisabledRoot + path.sep)) {
    return parent === userRoot || parent === userDisabledRoot;
  }
  // 项目级：任意 .../.agents/skills/<name>（含 skills.disabled）
  return (parentName === 'skills' || parentName === 'skills.disabled')
    && path.basename(path.dirname(parent)) === '.agents';
}

export function uninstallSkill(skillDir: string): void {
  const resolved = path.resolve(skillDir);
  if (!fs.existsSync(resolved)) throw new Error('技能目录不存在');
  if (isBundledSkillDir(resolved)) {
    throw new Error('安装自带的技能不能卸载');
  }
  if (!isManagedSkillDir(resolved)) {
    throw new Error(`只能卸载 ~/.agents/skills 或项目 .agents/skills 下由 ${brand.name} 管理的技能`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

/** 停用/启用：技能目录在 skills/ ↔ skills.disabled/ 之间同级移动（scope 天然保持）。pi 只扫 skills/，挪出即隐形。 */
export function setSkillEnabled(skillDir: string, enabled: boolean): void {
  const resolved = path.resolve(skillDir);
  if (!fs.existsSync(resolved)) throw new Error('技能目录不存在');
  if (isBundledSkillDir(resolved)) {
    throw new Error('安装自带的技能不能停用');
  }
  if (!isManagedSkillDir(resolved)) {
    throw new Error(`只能停用 ~/.agents/skills 或项目 .agents/skills 下由 ${brand.name} 管理的技能`);
  }
  const parent = path.dirname(resolved);
  const isDisabled = path.basename(parent) === 'skills.disabled';
  if (isDisabled === !enabled) return; // 已是目标态
  const targetRoot = path.join(
    path.dirname(parent),
    isDisabled ? 'skills' : 'skills.disabled',
  );
  fs.mkdirSync(targetRoot, { recursive: true });
  const dest = path.join(targetRoot, path.basename(resolved));
  if (fs.existsSync(dest)) throw new Error(`目标位置已存在同名技能目录：${dest}`);
  fs.renameSync(resolved, dest);
}
