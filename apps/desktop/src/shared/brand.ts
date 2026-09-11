/**
 * 品牌配置：LongMa（主品牌）/ Fundet（双品牌变体）。
 * 构建期由环境变量 BRAND 选择（electron.vite.config.ts 注入 __BRAND__），
 * 两品牌功能完全一致，只有名称、自我介绍口径、logo 与更新源不同。
 *
 * 注意：productName 由 electron-builder 配置决定（决定安装目录与
 * userData 隔离，%APPDATA%\LongMa vs %APPDATA%\Fundet），渲染层/main
 * 运行时展示统一走这里。
 */
export type BrandId = 'longma' | 'fundet';

/** 内网 GitLab generic 更新源（electron-updater generic provider） */
export interface UpdaterFeed {
  /** GitLab API 基址（http://…/api/v4） */
  apiBase: string;
  /** 项目数字 id */
  projectId: string;
  /** 手动下载的 Release 页（macOS / 兜底） */
  releasePage: string;
  /** 私有项目须配置个人访问令牌（scope=api）才能检查更新 */
  requiresToken: boolean;
}

export interface BrandConfig {
  id: BrandId;
  /** 产品名（窗口标题、托盘、报错弹窗、自我介绍） */
  name: string;
  /** system-prompt 自我介绍里的身份短语 */
  assistantRole: string;
  /** 应用内更新源（GitHub owner/repo；fundet 独立 Releases） */
  updater: { owner: string; repo: string };
  /** GitLab generic 更新源；设置后覆盖 updater 的 GitHub 语义（longma 不设） */
  updaterFeed?: UpdaterFeed;
  /** 是否预装内置技能（Fundet 不预装） */
  bundledSkills: boolean;
}

declare const __BRAND__: BrandId;

const BRANDS: Record<BrandId, BrandConfig> = {
  longma: {
    id: 'longma',
    name: 'LongMa',
    assistantRole: '一个运行在本地的 AI 编程助手',
    updater: { owner: 'xiaosen6', repo: 'longma' },
    bundledSkills: true,
  },
  fundet: {
    id: 'fundet',
    name: 'Fundet',
    assistantRole: '一个运行在本地的 AI 助手',
    updater: { owner: 'xiaosen6', repo: 'fundet' },
    updaterFeed: {
      // 两跳解析：先 GET releases?per_page=1 拿最新 tag，再指
      // /releases/<tag>/downloads/ 做 generic feed（latest.yml/安装包按 filepath 挂链）
      apiBase: 'http://172.16.56.11/api/v4',
      projectId: '272',
      releasePage: 'http://172.16.56.11/fundet-harness/fundet-buddy/-/releases',
      requiresToken: true,
    },
    bundledSkills: false,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const id = (typeof __BRAND__ !== 'undefined' ? __BRAND__ : (globalThis as any).__LONGMA_BRAND__ ?? 'fundet') as BrandId;

export const brand: BrandConfig = BRANDS[id] ?? BRANDS.fundet;
