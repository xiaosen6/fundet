/**
 * 跨路由 agent 意图（桌宠点击 / 系统通知点击）的模块级中转。
 *
 * 2026-11-24 修复：此前这些事件的订阅挂在 ChatPage 的 effect 上——离开聊天
 * 路由（如停在设置页）就解绑，主进程照常推送但无人接收：点桌宠没反应、点
 * 通知没反应。现在全局捕获（sessionStore.initGlobalListeners），没有消费者
 * （ChatPage 未挂载）时先排队，挂载后补投；路由跳转由 main.tsx 订阅处理。
 *
 * notify-open-session 的会话切换在捕获点直接做（store 层能力），意图本身
 * 仍会广播（导航到聊天页）。
 */

export type AgentIntent =
  | { type: 'pet-screenshot'; base64: string }
  | { type: 'pet-new-chat' }
  | { type: 'notify-open-session'; sessionId: string };

const queue: AgentIntent[] = [];
const listeners = new Set<(intent: AgentIntent) => void>();

export function pushAgentIntent(intent: AgentIntent): void {
  if (listeners.size > 0) {
    for (const listener of listeners) listener(intent);
    return;
  }
  // 没有消费者：排队等 ChatPage 挂载补投（容量上限防泄漏——截图 base64 不小）
  if (queue.length >= 8) queue.shift();
  queue.push(intent);
}

/** 订阅意图；订阅时先把排队的补投给新消费者（只补投一次，不重复消费） */
export function subscribeAgentIntents(cb: (intent: AgentIntent) => void): () => void {
  listeners.add(cb);
  const backlog = queue.splice(0);
  for (const intent of backlog) cb(intent);
  return () => {
    listeners.delete(cb);
  };
}
