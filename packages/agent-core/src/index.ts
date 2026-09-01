/**
 * @fundet/agent-core — Fundet agent 核心抽象层（Pi harness + 会话编排 + 记忆）
 *
 * 派生自 makecindy/cindy 的 packages/maker-core（Apache-2.0），裁剪为仅 Pi。
 * 严格约束：本包零 Electron 依赖。所有 IO（safeStorage / userData / spawn 路径）
 * 由 host 层实现并通过依赖注入传入。
 */

export const VERSION = '0.0.0';

// types
export * from './types/index.js';

// interfaces
export * from './interfaces/index.js';

// agents
export * from './agents/index.js';
export { evaluatePiProjectTrust, piProjectKey } from './agents/pi/project-trust.js';
export {
  assertReviewMessageContentPaths,
  buildReviewReadGrants,
  pathIsWithinReviewGrant,
  reviewFileLinkLayoutIsSafe,
  resolveReviewReadPath,
  type ReviewReadGrant,
} from './agents/shared/review-read-scope.js';
export { isReviewSensitiveCredentialPath } from './agents/shared/sensitive-credential-paths.js';

// core
export * from './session.js';
export * from './session-send-outcome.js';
export * from './maker.js';
export * from './types/context-usage.js';

// maker memory (cross-agent shared workdir-scoped memory)
export * from './memory/types.js';
export {
  MemoryStorage,
  sanitizeWorkdir,
  buildMemoryScopeKey,
  memoryScopeDirName,
  buildFilename,
  parseFilename,
  validateSlug,
  type MemoryStorageMeta,
} from './memory/storage.js';
export { MemoryFts } from './memory/fts.js';
export {
  MakerMemoryStore,
  type MakerMemoryStoreDeps,
  type ConsolidateOptions,
  type ConsolidateResult,
} from './memory/store.js';
export {
  MakerMemoryManager,
  type MakerMemoryManagerDeps,
  type MakerMemoryState,
  type SetEnabledResult,
  type SqliteFactory,
} from './memory/manager.js';
export {
  MemoryFlushController,
  DEFAULT_FLUSH_THRESHOLDS,
  type MemoryFlushControllerDeps,
} from './memory/flush-controller.js';
export { MAKER_MEMORY_RULES } from './memory/system-prompt.js';
