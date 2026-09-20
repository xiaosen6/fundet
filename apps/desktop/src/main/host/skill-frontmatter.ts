/**
 * SKILL.md frontmatter 校验（零依赖版，node --test 可直跑）。
 * 规则与 skill-package.ts（agent-core parseFrontmatter 路径）同口径：
 * name 匹配 [a-zA-Z0-9-]{1,200}、description 非空。skillhub 安装管线用它做
 * 落盘前校验；本地文件导入仍走 skill-package（同一套错误文案）。
 */
export const SKILL_NAME_RE = /^[a-zA-Z0-9-]{1,200}$/;

function extractFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function validateSkillMarkdown(raw: string, fallbackName?: string): { name: string; description: string } {
  const fm = extractFrontmatter(raw);
  const name = (fm.name ?? '').trim() || (fallbackName ?? '');
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error('技能 name 必须匹配 [a-z0-9-]{1,200}（写在 SKILL.md YAML frontmatter）');
  }
  const description = (fm.description ?? '').trim();
  if (!description) {
    throw new Error('SKILL.md frontmatter 必须包含非空 description');
  }
  return { name, description };
}
