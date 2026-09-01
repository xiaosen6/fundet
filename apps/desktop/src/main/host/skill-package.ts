/**
 * 本地技能包校验：Cindy 同口径 name/description + SKILL.md。
 */
import { parseFrontmatter } from '@fundet/agent-core';

export const SKILL_NAME_RE = /^[a-zA-Z0-9-]{1,200}$/;

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export function parseSkillMarkdown(raw: string, fallbackName?: string): SkillFrontmatter {
  const { frontmatter, parseError } = parseFrontmatter(raw);
  if (parseError) throw new Error(`SKILL.md frontmatter 无法解析: ${parseError}`);
  const nameRaw = typeof frontmatter?.name === 'string' ? frontmatter.name.trim() : '';
  const name = nameRaw || (fallbackName ?? '');
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error('技能 name 必须匹配 [a-z0-9-]{1,200}（写在 SKILL.md YAML frontmatter）');
  }
  const description =
    typeof frontmatter?.description === 'string' ? frontmatter.description.trim() : '';
  if (!description) {
    throw new Error('SKILL.md frontmatter 必须包含非空 description');
  }
  return { name, description };
}
