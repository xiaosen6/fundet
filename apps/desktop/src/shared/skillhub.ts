/**
 * SkillHub（skillhub.cn）集市类型——主/渲染共用。
 * 字段全部来自真机抓包（__fixtures__/skillhub-*.json），解析器按此归一化。
 */

/** 搜索/榜单条目（GET /api/v1/search） */
export interface SkillhubSkillView {
  slug: string;
  name: string;
  /** 中文描述优先，缺省回落英文 */
  description: string;
  category: string;
  downloads: number;
  installs: number;
  stars: number;
  iconUrl: string | null;
  owner: string;
  source: string;
  /** 需要 API key 的技能（labels.requires_api_key） */
  requiresApiKey: boolean;
  updatedAtMs: number | null;
  version: string | null;
}

export type SkillhubSort = 'downloads' | 'trending' | 'stars' | 'score';

/** 详情（GET /api/v1/skills/{slug}） */
export interface SkillhubSecurityReport {
  provider: string;
  /** benign / suspicious / unknown …（各家文案，statusText 是人话） */
  status: string;
  statusText: string | null;
  reportUrl: string | null;
}

export interface SkillhubDetailView {
  slug: string;
  name: string;
  description: string;
  overview: string | null;
  category: string | null;
  tags: string[];
  owner: string;
  verified: boolean;
  latestVersion: string | null;
  changelog: string | null;
  updatedAtMs: number | null;
  stats: { downloads: number; installs: number; stars: number };
  securityReports: SkillhubSecurityReport[];
}

/** 安装清单条目（GET /api/v1/skills/{slug}/files） */
export interface SkillhubFileEntry {
  path: string;
  sha256: string;
  size: number;
}

/** 已装技能的可更新检查结果 */
export interface SkillhubUpdateView {
  slug: string;
  current: string;
  latest: string;
}

/** 安装结果 */
export interface SkillhubInstallResult {
  slug: string;
  /** 落盘目录（~/.agents/skills/<slug>） */
  dir: string;
  version: string | null;
}
