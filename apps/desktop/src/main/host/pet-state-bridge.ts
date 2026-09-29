/**
 * PetStateBridge —— 把宿主信号映射为桌宠状态指令。
 *
 * 信号源（均为既有通道，不新造）：
 * - agent 事件流（register.ts wireSession 广播）
 * - 审批/问答请求（register.ts setInteractionListener——不经 agent 事件流，单独桥接）
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
    case 'interaction_dismissed':
      setState('idle');
      break;
    default:
      break;
  }
}

/** 审批/问答请求到达 → 短暂通知（用户不在主窗时桌宠提示需要确认） */
export function bridgeInteractionRequest(): void {
  setState('notify');
  setTimeout(() => setState('idle'), 3000);
}

/** 重置（会话关闭等） */
export function bridgeReset(): void {
  setState('idle');
}
