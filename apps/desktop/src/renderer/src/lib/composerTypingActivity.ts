/**
 * composer 打字活动窗口（Cindy #5a5004446 移植，Fundet 简化版）。
 *
 * 用户正在输入时把流式 delta 的 32ms 帧级合帧拉长到 250ms：多会话并行动时，
 * 任意后台会话的每次合帧都会经 notifyAny 重渲染跨会话视图（ChatPage/Sidebar），
 * 把按键延迟吃掉。窗口 800ms，过期自动回落。
 *
 * Fundet 的 composer 是普通受控 textarea：每个 DOM onChange 都是真实用户输入，
 * 不需要 Cindy 为 Tiptap 程序化 onChange 准备的甄别装置——语音/模板插入直调
 * onChange prop、不产生 DOM input 事件，天然不会误开窗。
 */

const TYPING_WINDOW_MS = 800;

let lastTypingAt = 0;

export function markComposerTypingActivity(): void {
  lastTypingAt = Date.now();
}

export function isComposerTypingRecently(): boolean {
  return Date.now() - lastTypingAt < TYPING_WINDOW_MS;
}

/** 测试专用：清零窗口状态。 */
export function __resetComposerTypingActivityForTest(): void {
  lastTypingAt = 0;
}
