/**
 * PetStateBridge —— 把 agent 事件映射为桌宠状态指令。
 *
 * 消费现有信号（不新造）：
 * - sessionStore 的 agent 事件流（经 register.ts 的 wireSession 已有广播）
 * - pendingInteractions（权限确认）
 * - IM 消息到达
 */
import { pushPetState } from './pet-host.js';

/** 上一次设置的状态（去重） */
let lastState = 'idle';

function setState(state: string): void {
  if (state === lastState) return;
  lastState = state;
  pushPetState(state);
}

/**
 * 从 agent 事件推断桌宠状态（由 register.ts 的 wireSession 事件回调调用）。
 * 事件类型与 sessionStore 的 applyEvent 对齐。
 */
export function bridgeAgentEvent(eventType: string, data: Record<string, unknown>): void {
  switch (eventType) {
    case 'status':
      if (data.isRunning === true) setState('thinking');
      break;
    case 'done':
      // 完成时短暂通知
      setState('notify');
      setTimeout(() => setState('idle'), 2000);
      break;
    case 'error':
      setState('notify');
      setTimeout(() => setState('idle'), 3000);
      break;
    case 'interaction_request':
      setState('notify');
      break;
    case 'interaction_dismissed':
      setState('idle');
      break;
    default:
      break;
  }
}

/** IM 消息到达 → 通知 */
export function bridgeImMessage(): void {
  setState('notify');
  setTimeout(() => setState('idle'), 2500);
}

/** 重置（会话关闭等） */
export function bridgeReset(): void {
  setState('idle');
}
