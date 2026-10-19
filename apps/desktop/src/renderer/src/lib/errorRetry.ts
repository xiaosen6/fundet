/** 兼容层：纯逻辑已移 shared/error-retry（主进程 outbox 重试调度共用同一分类器）。 */
export {
  classifyRetryableError,
  retryDelayMs,
  MAX_AUTO_RETRY_ATTEMPTS,
} from "../../../shared/error-retry.ts";
export type { RetryKind, RetryPlanSeed } from "../../../shared/error-retry.ts";
