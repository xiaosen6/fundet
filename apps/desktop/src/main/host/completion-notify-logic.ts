/**
 * 完成提醒纯判定（无 electron 依赖，node --test 直跑）。
 */

/** 主窗是否正被用户注视：可见、未最小化、聚焦。
 * 最小化必须显式排除——Windows 上应用自最小化（标题栏按钮/Win+D）且没有别的
 * 窗口接走焦点时，Electron 的 isFocused() 仍返回 true（2026-09-30 探针实锤），
 * 只看 isVisible+isFocused 会把「已最小化」误判成「正盯着看」→ 提醒被静默。 */
export function isWindowWatching(
  win: { isVisible(): boolean; isFocused(): boolean; isMinimized(): boolean } | null,
): boolean | null {
  if (!win) return null;
  return win.isVisible() && !win.isMinimized() && win.isFocused();
}

/** 纯判定：开关开 + 主窗非「正被注视」才提醒；窗口不存在也提醒 */
export function shouldNotifyCompletion(args: { enabled: boolean; mainWindowFocused: boolean | null }): boolean {
  if (!args.enabled) return false;
  return args.mainWindowFocused !== true;
}
