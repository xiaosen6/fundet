/**
 * Browser MCP 门面的宿主依赖契约（从 Cindy @cindy/mcps types.ts 摘出的最小集）。
 * 门面包保持零 Electron 依赖：host 通过 deps 注入 runtime 与可选的 L2 配方层。
 */
import type { BrowserControlRuntime } from '@fundet/browser-runtime';
import type { Recipe, SiteGuide } from './recipe-loader.js';

export interface LiziMcpLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal?(...args: unknown[]): void;
}

export interface BrowserMcpDeps {
  getRuntime(): BrowserControlRuntime;
  /** Whether the active backend accepts managed resource downloads. */
  supportsResourceDownloads?(): boolean;
  /** Whether the active backend accepts semantic element queries. */
  supportsSemanticQueries?(): boolean;
  logger?: LiziMcpLogger;
  /**
   * Optional L2 (user-local) recipe layer. Absent → only the bundled L1
   * catalog is used.
   */
  getUserRecipes?(): Promise<{
    recipes: Map<string, Recipe>;
    siteGuides: Map<string, SiteGuide>;
    version: string;
  }>;
  /**
   * Optional self-grow write path: persist an agent/user-authored recipe (and
   * optional site guide) into the L2 layer. The MCP validates the draft with the
   * `RecipeSchema` before calling this; the host just writes JSON to userData.
   */
  saveUserRecipe?(input: {
    site: string;
    recipe: Recipe;
    siteGuide?: SiteGuide;
  }): Promise<{ ok: boolean; path?: string; message?: string }>;
}
