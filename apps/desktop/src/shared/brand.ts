/**
 * 品牌配置：LongMa（主品牌）/ Fundet（双品牌变体）。
 * 构建期由环境变量 BRAND 选择（electron.vite.config.ts 注入 __BRAND__），
 * 两品牌功能完全一致，只有名称、自我介绍口径、logo 与更新源不同。
 * 更新源自 0.2.19 起统一 GitHub Releases（公开仓免令牌；GitLab generic
 * feed 已于 2026-09 清理移除）。
 *
 * 注意：productName 由 electron-builder 配置决定（决定安装目录与
 * userData 隔离，%APPDATA%\LongMa vs %APPDATA%\Fundet），渲染层/main
 * 运行时展示统一走这里。
 */
export type BrandId = 'longma' | 'fundet';

export interface BrandConfig {
  id: BrandId;
  /** 产品名（窗口标题、托盘、报错弹窗、自我介绍） */
  name: string;
  /** system-prompt 自我介绍里的身份短语 */
  assistantRole: string;
  /** 应用内更新源（GitHub owner/repo；fundet 独立 Releases） */
  updater: { owner: string; repo: string };
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
    // 0.3.0 曾改「未灵」——09-21 用户拍板改回 Fundet（含欢迎页 lockup、系统
    // 提示词身份、全部展示位）；技术标识本来就没动过，无需任何迁移。
    name: 'Fundet',
    assistantRole: '一个运行在本地的 AI 助手',
    updater: { owner: 'xiaosen6', repo: 'fundet' },
    bundledSkills: false,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const id = (typeof __BRAND__ !== 'undefined' ? __BRAND__ : (globalThis as any).__LONGMA_BRAND__ ?? 'fundet') as BrandId;

export const brand: BrandConfig = BRANDS[id] ?? BRANDS.fundet;
