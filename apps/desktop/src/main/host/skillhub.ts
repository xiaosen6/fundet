/**
 * SkillHub（skillhub.cn）集市客户端：浏览 / 搜索 / 详情 / 一键安装 / 更新检查。
 *
 * 接口全部匿名可用（api.skillhub.cn，腾讯 CDN，国内直连 ~200-400ms，实测见
 * __fixtures__ 真机抓包）。无官方限流条款——客户端自律：列表 TTL 缓存 10min，
 * 下载并发 4，单技能文件数/体积上限。
 *
 * 安装管线（可注入依赖，单测直跑真实落盘流）：
 *   files 清单 → 逐文件下载（302→COS） → 逐文件 sha256 校验 → 临时目录全量
 *   通过后原子改名进 ~/.agents/skills/<slug>/ → 写 skillhub.json 元数据（更新
 *   检测用）→ pi 自动扫描生效。任何一步失败整体放弃并清理残留，绝不落半个技能。
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateSkillMarkdown } from './skill-frontmatter.ts';
import type {
  SkillhubDetailView,
  SkillhubFileEntry,
  SkillhubInstallResult,
  SkillhubSecurityReport,
  SkillhubSkillView,
  SkillhubSort,
  SkillhubUpdateView,
} from '../../shared/skillhub.ts';

const requireElectron = createRequire(import.meta.url);

const API_BASE = 'https://api.skillhub.cn/api/v1';
/** 列表/搜索缓存：防抖 + 对上游友好 */
const LIST_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
/** 安装护栏 */
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 4;
/** 落盘目录名：skillhub slug 已是 [a-z0-9-]，防御性再清洗 */
const DIR_NAME_RE = /^[a-z0-9][a-z0-9-]{0,100}$/;
/** 清单路径白名单字符（允许下划线打头——真机包普遍含 _meta.json；拒绝穿越/绝对/反斜杠） */
const FILE_PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,200}$/;

/* ---------------- 纯解析（fixture 单测） ---------------- */

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function ms(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseSkillhubSearch(raw: string): SkillhubSkillView[] {
  let j: { results?: unknown };
  try {
    j = JSON.parse(raw) as { results?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(j.results)) return [];
  return j.results
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const labels = (typeof r.labels === 'object' && r.labels !== null ? r.labels : {}) as Record<string, unknown>;
      return {
        slug: str(r.slug) ?? '',
        name: str(r.displayName) ?? str(r.name) ?? '',
        description: str(r.description_zh) ?? str(r.description) ?? '',
        category: str(r.category) ?? '',
        downloads: num(r.downloads),
        installs: num(r.installs),
        stars: num(r.stars),
        iconUrl: str(r.icon_url),
        owner: str(r.owner_name) ?? '',
        source: str(r.source) ?? '',
        requiresApiKey: labels.requires_api_key === 'true',
        updatedAtMs: ms(r.updated_at ?? r.updatedAt),
        version: str(r.version),
      } satisfies SkillhubSkillView;
    })
    .filter((s) => s.slug && s.name);
}

export function parseSkillhubDetail(raw: string): SkillhubDetailView | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sk = (typeof j.skill === 'object' && j.skill !== null ? j.skill : {}) as Record<string, unknown>;
  const lv = (typeof j.latestVersion === 'object' && j.latestVersion !== null ? j.latestVersion : {}) as Record<string, unknown>;
  const owner = (typeof j.owner === 'object' && j.owner !== null ? j.owner : {}) as Record<string, unknown>;
  const stats = (typeof sk.stats === 'object' && sk.stats !== null ? sk.stats : {}) as Record<string, unknown>;
  const reportsRaw = (typeof j.securityReports === 'object' && j.securityReports !== null ? j.securityReports : {}) as Record<string, unknown>;
  const securityReports: SkillhubSecurityReport[] = [];
  for (const [provider, rep] of Object.entries(reportsRaw)) {
    if (typeof rep !== 'object' || rep === null) continue;
    const r = rep as Record<string, unknown>;
    securityReports.push({
      provider,
      status: str(r.status) ?? 'unknown',
      statusText: str(r.statusText),
      reportUrl: str(r.reportUrl),
    });
  }
  return {
    slug: str(j.slug) ?? '',
    name: str(sk.displayName) ?? str(sk.slug) ?? '',
    description: str(sk.summary_zh) ?? str(sk.summary) ?? '',
    overview: str(sk.overviewMd),
    category: str(sk.category),
    tags: Array.isArray(sk.tags) ? sk.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [],
    owner: str(owner.displayName) ?? str(owner.handle) ?? '',
    verified: sk.isAuthorVerified === true || sk.verified === true,
    latestVersion: str(lv.version),
    changelog: str(lv.changelog),
    updatedAtMs: ms(lv.createdAt) ?? ms(sk.updatedAt),
    stats: { downloads: num(stats.downloads), installs: num(stats.installs), stars: num(stats.stars) },
    securityReports,
  };
}

export function parseSkillhubFiles(raw: string): SkillhubFileEntry[] {
  let j: { files?: unknown };
  try {
    j = JSON.parse(raw) as { files?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(j.files)) return [];
  return j.files
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({ path: str(f.path) ?? '', sha256: (str(f.sha256) ?? '').toLowerCase(), size: num(f.size) }))
    .filter((f) => f.path && f.sha256.length === 64);
}

/** 清单防线：路径安全 + 数量/体积上限（返回错误文案，null=通过） */
export function validateManifest(files: SkillhubFileEntry[]): string | null {
  if (files.length === 0) return '技能没有文件';
  if (files.length > MAX_FILES) return `文件数超上限（${files.length} > ${MAX_FILES}）`;
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return `总体积超上限（${(total / 1024 / 1024).toFixed(1)}MB）`;
  for (const f of files) {
    if (!FILE_PATH_RE.test(f.path) || f.path.includes('..')) return `非法文件路径：${f.path.slice(0, 60)}`;
    if (f.size < 0 || f.size > MAX_TOTAL_BYTES) return `文件大小异常：${f.path.slice(0, 60)}`;
  }
  if (!files.some((f) => f.path === 'SKILL.md')) return '缺少 SKILL.md（不是标准技能包）';
  return null;
}

/* ---------------- 网络层（可注入） ---------------- */

export interface SkillhubDeps {
  fetchJson: (apiPath: string) => Promise<string>;
  /** 下载文件内容（302→COS 由 fetch 自动跟随） */
  fetchFile: (slug: string, filePath: string) => Promise<Buffer>;
  /** 落盘根目录（默认 ~/.agents/skills；单测注入临时目录） */
  skillsRoot: () => string;
  /** 下载图标（协议代理用；返回 null = 非法/超限/非图片，单测注入假实现） */
  fetchIcon: (url: string) => Promise<{ contentType: string; bytes: Buffer } | null>;
}

async function realFetchJson(apiPath: string): Promise<string> {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SkillHub 接口 ${res.status}`);
  return res.text();
}

async function realFetchFile(slug: string, filePath: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(filePath)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 2),
  });
  if (!res.ok) throw new Error(`文件下载失败 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const ICON_MAX_BYTES = 1024 * 1024;

async function realFetchIcon(url: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return null;
  return { contentType, bytes };
}

function defaultDeps(): SkillhubDeps {
  return {
    fetchJson: realFetchJson,
    fetchFile: realFetchFile,
    fetchIcon: realFetchIcon,
    skillsRoot: () => {
      const { app } = requireElectron('electron') as typeof import('electron');
      const home = (() => {
        try {
          return app.getPath('home');
        } catch {
          return process.env.USERPROFILE ?? process.env.HOME ?? '.';
        }
      })();
      return path.join(home, '.agents', 'skills');
    },
  };
}

let deps: SkillhubDeps = defaultDeps();

/** 单测注入 */
export function setSkillhubDeps(d: Partial<SkillhubDeps>): void {
  deps = { ...deps, ...d };
}

/* ---------------- 列表 / 搜索 / 详情（带 TTL 缓存） ---------------- */

const cache = new Map<string, { at: number; data: unknown }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return Promise.resolve(hit.data as T);
  return load().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

function searchQuery(params: {
  keyword?: string;
  sort?: SkillhubSort;
  category?: string;
  limit?: number;
}): string {
  const q = new URLSearchParams();
  q.set('keyword', params.keyword?.trim() ?? '');
  q.set('sort', params.sort ?? 'downloads');
  if (params.category && params.category !== 'all') q.set('category', params.category);
  q.set('limit', String(Math.min(Math.max(params.limit ?? 30, 1), 50)));
  return `/search?${q.toString()}`;
}

export function listSkillhubSkills(params: {
  keyword?: string;
  sort?: SkillhubSort;
  category?: string;
  limit?: number;
}): Promise<SkillhubSkillView[]> {
  const qs = searchQuery(params);
  return cached(`list:${qs}`, async () =>
    parseSkillhubSearch(await deps.fetchJson(qs)),
  );
}

export async function getSkillhubDetail(slug: string): Promise<SkillhubDetailView | null> {
  const safe = encodeURIComponent(slug);
  return parseSkillhubDetail(await deps.fetchJson(`/skills/${safe}`));
}

/* ---------------- 安装管线 ---------------- */

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 并发受控地跑完全部任务 */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await run(items[i]!);
    }
  });
  await Promise.all(workers);
}

export async function installSkillhubSkill(
  slug: string,
  opts: { replace?: boolean } = {},
): Promise<SkillhubInstallResult> {
  if (!DIR_NAME_RE.test(slug)) throw new Error(`非法技能标识：${slug.slice(0, 40)}`);
  const [detail, filesRaw] = await Promise.all([
    getSkillhubDetail(slug).catch(() => null),
    deps.fetchJson(`/skills/${encodeURIComponent(slug)}/files`),
  ]);
  const files = parseSkillhubFiles(filesRaw);
  const invalid = validateManifest(files);
  if (invalid) throw new Error(invalid);

  const root = deps.skillsRoot();
  const target = path.join(root, slug);
  if (fs.existsSync(target) && !opts.replace) throw new Error('已安装（可在已安装列表里更新/卸载）');

  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `.skillhub-tmp-${randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(tmp, { recursive: true });
    // 下载 + 校验（任一失败整体抛出）
    await pool(files, DOWNLOAD_CONCURRENCY, async (f) => {
      const buf = await deps.fetchFile(slug, f.path);
      if (sha256(buf) !== f.sha256) throw new Error(`校验失败：${f.path}`);
      const dest = path.join(tmp, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    });
    // SKILL.md 必须是合法技能（零依赖校验器，与本地导入同规则）
    const skillMd = fs.readFileSync(path.join(tmp, 'SKILL.md'), 'utf-8');
    validateSkillMarkdown(skillMd, slug);
    // 元数据（更新检测对账）
    const meta = {
      source: 'skillhub.cn',
      slug,
      version: detail?.latestVersion ?? null,
      installedAt: Date.now(),
    };
    fs.writeFileSync(path.join(tmp, 'skillhub.json'), JSON.stringify(meta, null, 2));
    // 原子落位：旧目录（更新场景）先挪走再换新，失败可回滚
    let backup: string | null = null;
    if (fs.existsSync(target)) {
      backup = `${target}.old-${randomBytes(4).toString('hex')}`;
      fs.renameSync(target, backup);
    }
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      if (backup) fs.renameSync(backup, target);
      throw e;
    }
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
    return { slug, dir: target, version: meta.version };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/* ---------------- 更新检查 ---------------- */

interface LocalMeta {
  source?: string;
  slug?: string;
  version?: string | null;
}

/** 扫已装目录里的 skillhub.json 元数据 */
export function listInstalledSkillhub(root: string): Array<{ slug: string; version: string | null; dir: string }> {
  const out: Array<{ slug: string; version: string | null; dir: string }> = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const metaPath = path.join(root, ent.name, 'skillhub.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as LocalMeta;
      if (meta.source === 'skillhub.cn' && typeof meta.slug === 'string') {
        out.push({ slug: meta.slug, version: meta.version ?? null, dir: path.join(root, ent.name) });
      }
    } catch {
      /* 非 skillhub 安装的技能，跳过 */
    }
  }
  return out;
}

export async function checkSkillhubUpdates(): Promise<SkillhubUpdateView[]> {
  const installed = listInstalledSkillhub(deps.skillsRoot()).slice(0, 20);
  const results = await Promise.all(
    installed.map(async (it) => {
      try {
        const d = await getSkillhubDetail(it.slug);
        if (d?.latestVersion && it.version && d.latestVersion !== it.version) {
          return { slug: it.slug, current: it.version, latest: d.latestVersion };
      }
      } catch {
        /* 单个失败不影响其余 */
      }
      return null;
    }),
  );
  return results.filter((r): r is SkillhubUpdateView => r !== null);
}

/* ---------------- 图标代理（skillhub-icon:// 协议的后端） ---------------- */

/** 实测图标 CDN 域（真机抓包只见腾讯系两域；新域出现时在此追加，未列域回落 Zap） */
const ICON_HOST_SUFFIXES = ['cloudcache.tencent-cloud.com', '.myqcloud.com', 'skillhub.cn'];

/** 主进程侧再校验一遍（渲染层给的 url 不可信）：仅 https + 白名单域 */
export function isAllowedIconUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !u.host) return false;
    return ICON_HOST_SUFFIXES.some((s) => (s.startsWith('.') ? u.host.endsWith(s) : u.host === s));
  } catch {
    return false;
  }
}

/** 魔数嗅探（缓存命中时没有响应头，Content-Type 从字节判） */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.subarray(0, 256).toString('utf-8').trimStart().startsWith('<')) return 'image/svg+xml';
  return null;
}

const iconInflight = new Map<string, Promise<Buffer | null>>();

/** 图标取回：磁盘缓存（sha256(url) 命名）→ 命中直读；未命中经 deps.fetchIcon 下载，
 *  校验（白名单域/≤1MB/魔数可辨）后落缓存。并发去重。失败 null（渲染层回退 Zap）。 */
export async function fetchSkillhubIcon(url: string, cacheDir: string): Promise<Buffer | null> {
  if (!isAllowedIconUrl(url)) return null;
  const cacheFile = path.join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.bin`);
  try {
    const cached = fs.readFileSync(cacheFile);
    if (sniffImageType(cached)) return cached;
  } catch {
    /* 未命中，走下载 */
  }
  const running = iconInflight.get(url);
  if (running) return running;
  const p = (async (): Promise<Buffer | null> => {
    const r = await deps.fetchIcon(url);
    if (!r || !sniffImageType(r.bytes)) return null;
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, r.bytes);
    } catch {
      /* 缓存写失败不影响本次返回 */
    }
    return r.bytes;
  })();
  iconInflight.set(url, p);
  try {
    return await p;
  } finally {
    iconInflight.delete(url);
  }
}
