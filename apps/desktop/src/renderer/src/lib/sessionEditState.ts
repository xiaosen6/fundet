/**
 * 会话编辑态的两条纯判定（单测覆盖，均来自 2026-10-20 UI 走查的真实踩坑）。
 *
 * 1. `errorRetriable` —— 终态错误卡的「重新发送」只属于最后一轮。
 *    error 会随历史落库、`rebuildItems` 会把它重建进 items，于是旧轮的错误卡
 *    也带着按钮；而重发实现取的是「最后一条 user 消息」。旧卡一点，重跑的是
 *    最新一轮，可能重复执行一个已经失败过的危险任务。
 *
 * 2. `editSubmitSettles` —— 编辑消息提交失败时必须留在编辑态。
 *    `submitUserEdit` 失败只 `setNotice` 后 return（Promise 正常 resolve），
 *    UserTurn 的 `.then(() => setEditing(false))` 当成功处理：编辑框关闭、
 *    用户改好的文字凭空消失。
 */

/** 该 error 项是否值得显示「重新发送」：其后不存在新的 user 消息。
 *  以**最靠后那条 user 消息**为界——它之后的 error 属于最后一轮。 */
export function errorRetriable(
  items: ReadonlyArray<{ kind: string; id: string }>,
  errorId: string,
): boolean {
  let lastUserIndex = -1;
  let errorIndex = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === 'user') lastUserIndex = i;
    else if (it.kind === 'error' && it.id === errorId) errorIndex = i;
  }
  if (errorIndex < 0) return false;
  return errorIndex > lastUserIndex;
}

/** 提交编辑后是否该收起编辑框（false 提交 = 失败，草稿必须留着） */
export function editSubmitSettles(result: boolean | void): boolean {
  return result !== false;
}
