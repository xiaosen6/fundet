/**
 * 草稿转正判定（纯逻辑，单测覆盖）。
 *
 * 背景：草稿与真正落库的会话共用同一个 sessionId（prewarm 在草稿创建时就预落
 * sessions 行）。首条消息派发后，DB 行被自动标题改名（如「你好」），而渲染层
 * drafts 里还留着标题「新对话」的同 id 草稿——两边同时进侧栏就是两行。
 * 0.3.48 的 outbox 批重写 sendMessage 时丢了 pending 版本的 `drafts.delete`，
 * 2026-10-20 用户实报「新建会话发送消息后左侧出现两个会话栏」。
 *
 * 判定口径：草稿**已有对话内容**（首条消息已乐观插入）且 **DB 列表已有同 id 行**
 * → 摘除草稿。不含「无对话」的草稿：prewarm 一创建就有 DB 占位行，若无条件摘除
 * 会在用户还没发消息时把正在编辑的草稿干掉。
 */

export interface DraftPromotionInput {
  draftIds: Iterable<string>;
  hasDialogue: (id: string) => boolean;
  dbIds: ReadonlySet<string>;
}

export function promotableDraftIds(input: DraftPromotionInput): string[] {
  const out: string[] = [];
  for (const id of input.draftIds) {
    if (input.hasDialogue(id) && input.dbIds.has(id)) out.push(id);
  }
  return out;
}
