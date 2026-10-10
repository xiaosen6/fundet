/**
 * artifactPathChips —— AI 回复正文里的「产物文件名 / 文件路径 → 路径 chip」
 * 识别与切分（对齐 Cindy remarkLocalPathLinks 的思路：把正文纯文本里长得像
 * 本地文件路径的 token 切成 mdast link 节点，复用链接渲染链路）。
 *
 * 与 Cindy 的差异（Fundet 无主进程 pathResolver，改用「已知产物全集」消歧）：
 * - 路线 A（产物 basename）：Canvas 产物列表（write/edit 工具 + 附件 + 轮末
 *   turn:artifacts 扫描）已知路径的 basename 在正文出现 → 升级为 chip，
 *   悬停卡显示完整路径。产物名是结构化事实，歧义最小，允许紧贴 CJK。
 * - 路线 B（路径形状）：带盘符 / UNC / POSIX 根 / 「分隔符 + 扩展名」的相对
 *   路径 token。裸文件名（无分隔符）在正文里太歧义，不点（Cindy 同款取舍）。
 *
 * 只处理 mdast text 节点：code / inlineCode 是带 value 的叶子节点天然扫不到，
 * 行内 code 里的路径由 AssistantMessage 的 code 组件分支接（同一条 chip）。
 * 已在 link 里的 text 不动，避免嵌套链接；GFM autolink 先行把 http(s) URL
 * 变成 link，故 URL 天然跳过（正则另有 scheme 形状双保险）。
 *
 * 流式中间态不做（正文未封口、token 半截，chip 会闪）：AssistantMessage 只在
 * 终版渲染挂本插件，每条消息一次，成本与文本长度线性。
 */

/** link url 前缀：完整路径经 encodeURIComponent 编码挂在 hash 上。
 *  默认 urlTransform 对无裸冒号的 hash 原样放行，无需自定义 transform，
 *  也不破坏「链接/图片走受控组件」的安全基线。 */
export const ARTIFACT_HREF_PREFIX = '#artifact-path=';

/** 本地 mdast 最小类型（避免引入 unified 类型依赖） */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

// CJK / 假名 / 谚文：可作为路径段（中文目录名 / 文件名）
const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';
// 路径段字符（不含分隔符与 `:`；`:` 留给盘符）
const SEG = `[A-Za-z0-9._~@+\\-${CJK}]+`;
const SEP = '[\\\\/]';
const EXT = `\\.[A-Za-z0-9]{1,10}`;
// 锚点：盘符 / UNC 前缀 / POSIX 根 / 单分隔符
const ANCHOR = `(?:[A-Za-z]:${SEP}|\\\\\\\\|${SEP})`;
// 路径主体：锚点 + 中间段可有可无，或「段+分隔符」至少一组；末段必须扩展名收尾
const BODY = `(?:${ANCHOR}(?:${SEG}${SEP})*|(?:${SEG}${SEP})+)(?:${SEG})?${EXT}`;
// 左边界：前一字符不能是路径字符 / 分隔符（`:` 放行，允许「文件:src/x.ts」）
const LEFT = `(?<![A-Za-z0-9._~@+\\-${CJK}\\\\/])`;
// 右边界：扩展名后不能紧跟 ASCII 字母数字（防 `file.typescriptreact` 被截断）
const RIGHT = '(?![A-Za-z0-9])';

const PATH_TOKEN_RE = new RegExp(`${LEFT}(${BODY})${RIGHT}`, 'g');

// scheme 形状（https: / file: 等）——盘符是「单字母+冒号+分隔符」，先排除再放行
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DRIVE_RE = /^[A-Za-z]:[\\/]/;
// 首段像域名（www.a.com/x.md 这种裸 URL 路径）不点
const DOMAIN_FIRST_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?:$|[\\/])/;

const TRAILING_EXT_RE = /\.[A-Za-z0-9]{1,10}$/;

function basenameOf(p: string): string {
  const n = p.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

function hasSeparator(p: string): boolean {
  return p.includes('/') || p.includes('\\');
}

/** workDir + 相对路径（跟随 workDir 的分隔符风格，混合分隔符归一） */
export function joinWorkDir(workDir: string, rel: string): string {
  const sep = workDir.includes('\\') ? '\\' : '/';
  const base = workDir.replace(/[\\/]+$/, '');
  const tail = rel.replace(/^[\\/]+/, '').replace(/[\\/]/g, sep);
  return base ? `${base}${sep}${tail}` : tail;
}

/** 把 token 解析成完整路径；解析不出（不是产物也不是路径形状）返回 null */
export function resolveArtifactToken(
  token: string,
  knownPaths: readonly string[],
  workDir?: string,
): string | null {
  const t = token.trim();
  if (!t || t.includes('\n') || t.length > 512) return null;
  if (SCHEME_RE.test(t) && !DRIVE_RE.test(t)) return null;
  // 整路径已知（ci）→ 规范拼写；显式绝对路径是权威（哪怕与某产物同名，
  // 也指向它自己写的位置）；再到 basename 映射；最后相对路径拼 workDir
  const lower = t.toLowerCase();
  for (const p of knownPaths) {
    if (p.toLowerCase() === lower) return p;
  }
  if (DRIVE_RE.test(t) || t.startsWith('\\\\') || t.startsWith('/')) return t;
  const baseLower = basenameOf(lower);
  for (const p of knownPaths) {
    if (basenameOf(p.toLowerCase()) === baseLower) return p;
  }
  if (workDir && hasSeparator(t) && TRAILING_EXT_RE.test(t)) return joinWorkDir(workDir, t);
  return null;
}

export interface PathChipMatch {
  start: number;
  end: number;
  /** 命中的原文片段（chip 的显示文字） */
  token: string;
  /** 悬停卡展示 / 复制的完整路径 */
  fullPath: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 已知 basename 的合并正则缓存（按路径集签名；上限防膨胀） */
const basenameReCache = new Map<string, RegExp>();

function basenameReFor(knownPaths: readonly string[]): RegExp | null {
  const bases = new Set<string>();
  for (const p of knownPaths) {
    const b = basenameOf(p.trim());
    // 裸名太短 / 无扩展名的（Makefile）在正文里歧义大，不进路线 A
    if (b.length >= 4 && b.includes('.') && !hasSeparator(b)) bases.add(b);
  }
  if (bases.size === 0) return null;
  const sorted = [...bases].sort((a, b) => b.length - a.length);
  const key = sorted.join('\n');
  const cached = basenameReCache.get(key);
  if (cached) return cached;
  // 左边界不卡 CJK（中文紧贴产物名常见）；右边界卡 ASCII 路径字符，
  // 且「.后跟字母数字」视为更长文件名（draft.md.bak 不命中 draft.md），
  // 句末句点 / 省略号放行
  const re = new RegExp(
    `(?<![A-Za-z0-9._~@+\\\\/])(?:${sorted.map(escapeRe).join('|')})(?![A-Za-z0-9_~@+\\\\/])(?![.][A-Za-z0-9])`,
    'gi',
  );
  if (basenameReCache.size > 8) basenameReCache.clear();
  basenameReCache.set(key, re);
  return re;
}

/** 在一段纯文本里定位所有可点亮的路径 token（路线 A + B 合并去重叠） */
export function findArtifactPathMatches(
  text: string,
  knownPaths: readonly string[],
  workDir?: string,
): PathChipMatch[] {
  // 快速短路：无分隔符也无扩展名点缀的文本不可能命中
  if (!text.includes('/') && !text.includes('\\') && !text.includes('.')) return [];

  const raw: Array<{ start: number; token: string; fullPath: string }> = [];

  // 路线 B：路径形状 token
  PATH_TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    const token = m[1]!;
    if (SCHEME_RE.test(token) && !DRIVE_RE.test(token)) continue;
    if (DOMAIN_FIRST_RE.test(token)) continue;
    const start = m.index + (m[0].length - token.length);
    const fullPath = resolveArtifactToken(token, knownPaths, workDir);
    if (fullPath === null) continue;
    raw.push({ start, token, fullPath });
  }

  // 路线 A：已知产物 basename
  const basenameRe = basenameReFor(knownPaths);
  if (basenameRe) {
    const byBase = new Map<string, string>();
    for (const p of knownPaths) {
      const b = basenameOf(p.trim());
      if (b.length >= 4 && b.includes('.') && !hasSeparator(b)) byBase.set(b.toLowerCase(), p.trim());
    }
    basenameRe.lastIndex = 0;
    for (const m of text.matchAll(basenameRe)) {
      const token = m[0];
      const known = byBase.get(token.toLowerCase());
      if (!known) continue;
      raw.push({ start: m.index, token, fullPath: known });
    }
  }

  if (raw.length === 0) return [];

  // 去重叠：同起点长者胜；区间交叠时先到者（更早 / 更长）胜
  raw.sort((a, b) => a.start - b.start || b.token.length - a.token.length);
  const out: PathChipMatch[] = [];
  let lastEnd = -1;
  for (const r of raw) {
    if (r.start < lastEnd) continue;
    out.push({ start: r.start, end: r.start + r.token.length, token: r.token, fullPath: r.fullPath });
    lastEnd = r.start + r.token.length;
  }
  return out;
}

/** remark 插件：正文 text 节点按命中区间拆成 [text, link, text, ...]。
 *  用法（对齐 rehypeKnowledgeCite 的免依赖插件形态）：
 *  remarkPlugins={[[remarkArtifactPaths, { knownPaths, workDir }]]}
 */
export function remarkArtifactPaths(options: { knownPaths?: readonly string[]; workDir?: string } = {}) {
  const knownPaths = options.knownPaths ?? [];
  const workDir = options.workDir;
  return () =>
    (tree: MdNode): void => {
      const visit = (node: MdNode): void => {
        if (!node.children) return;
        // link / linkReference 子树不动：避免嵌套链接与重复点亮
        if (node.type === 'link' || node.type === 'linkReference') return;
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i]!;
          if (child.type === 'text' && child.value) {
            const matches = findArtifactPathMatches(child.value, knownPaths, workDir);
            if (matches.length === 0) continue;
            const replacement: MdNode[] = [];
            let cursor = 0;
            const value = child.value;
            for (const match of matches) {
              if (match.start > cursor) {
                replacement.push({ type: 'text', value: value.slice(cursor, match.start) });
              }
              replacement.push({
                type: 'link',
                url: ARTIFACT_HREF_PREFIX + encodeURIComponent(match.fullPath),
                children: [{ type: 'text', value: match.token }],
              });
              cursor = match.end;
            }
            if (cursor < value.length) {
              replacement.push({ type: 'text', value: value.slice(cursor) });
            }
            node.children.splice(i, 1, ...replacement);
            i += replacement.length - 1;
            continue;
          }
          visit(child);
        }
      };
      visit(tree);
    };
}

/** 解码插件塞进 href 的完整路径（异常回落原文） */
export function decodeArtifactHref(href: string): string {
  const raw = href.slice(ARTIFACT_HREF_PREFIX.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
