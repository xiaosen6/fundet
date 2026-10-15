/**
 * agent-home 启动清扫的纯逻辑（node --test 直测；IO 在 agent-home-cleanup.ts）。
 *
 * 背景（0.3.47 resume 接线后的语义变化）：pi 的会话 JSONL 转录从「纯死重」变成
 * 「重启恢复上下文的载体」——agent-home/sessions/ 必须跨启动保留，清扫从
 * 「全量删」改成「引用计数式 GC」：被 sessions 表 sdk_session_id 引用的转录保留，
 * 孤儿（删除会话后残留/预热丢弃/崩退残留）按 mtime 宽限期清扫。
 */
import path from 'node:path';

/** agentHome 根下保留的子目录：sessions=转录（GC 扫），run-tmp/runtime 整体删 */
export const AGENT_HOME_SESSIONS_DIR = 'sessions';

/** 启动时 agentHome 根目录清扫决策：sessions 保留（交给转录 GC），其余子项全删——
 *  run-tmp/<hex> 配置目录与 runtime/ 权限档都是 per-startSession 的一次性运行时
 *  （启动时没有活会话）；旧版随机 hex 目录（0.3.46 及更早的结构）一并铲除。 */
export function planRootSweep(childNames: string[]): string[] {
  return childNames.filter((n) => n !== AGENT_HOME_SESSIONS_DIR);
}

/** 孤儿转录清扫决策：sessions/ 下「不被 DB 引用」且「mtime 超过宽限期」的文件。
 *  宽限期防双实例拓扑（dev+打包版共享 userData）下扫掉另一个实例刚建、
 *  sdk_session_id 还没落库的转录。referenced 为引用集合（小写绝对路径）。 */
export function planTranscriptSweep(
  files: Array<{ name: string; mtimeMs: number }>,
  referencedLower: ReadonlySet<string>,
  sessionsDir: string,
  now: number,
  graceMs = 60 * 60 * 1000,
): string[] {
  return files
    .filter((f) => now - f.mtimeMs > graceMs)
    .filter((f) => !referencedLower.has(path.join(sessionsDir, f.name).toLowerCase()))
    .map((f) => path.join(sessionsDir, f.name));
}

/** 删除会话时的转录回收闸：sdkSessionId（DB 值）必须落在共享 sessions 目录内，
 *  防 DB 脏值把「删转录」变成任意文件删除原语。Windows 大小写不敏感按小写比。 */
export function isTranscriptPathWithin(sessionsDir: string, p: string): boolean {
  const resolved = path.resolve(p);
  return path.dirname(resolved).toLowerCase() === path.resolve(sessionsDir).toLowerCase();
}
