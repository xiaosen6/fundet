/**
 * IM 回合收口：等最终文本 + IM 自己的兜底超时。
 *
 * agent-core 的 turn-stall 看门狗阈值 45min（面向桌面长任务）；IM 场景一条
 * 回复等这么久等于机器人卡死，而 dispatcher 按 (channel, chatId) 排队，一条
 * 卡住会堵住该聊天后面的所有消息。这里到点即 abort 会话、回一句提示放行队列。
 */
import type { Session } from '@fundet/agent-core';

export const IM_TURN_TIMEOUT_MS = 10 * 60_000;

export interface TurnCollector {
  promise: Promise<string>;
  /** 会话拒收（turn 没跑起来，不会再有 done/error）时由调用方释放订阅 */
  dispose: () => void;
}

export function collectFinalText(
  session: Pick<Session, 'onEvent' | 'abort'>,
  timeoutMs: number = IM_TURN_TIMEOUT_MS,
): TurnCollector {
  let settled = false;
  let resolveText!: (text: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolveText = resolve;
  });
  let unsub: (() => void) | null = null;
  let timer: NodeJS.Timeout | undefined;

  const finish = (text: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unsub?.();
    resolveText(text);
  };

  let last = '';
  unsub = session.onEvent((event) => {
    if (event.type === 'text') {
      const data = event.data as { text?: string };
      if (typeof data.text === 'string' && data.text) last = data.text;
    }
    if (event.type === 'done') {
      finish(last.trim() || '（没有文字回复）');
    }
    if (event.type === 'error') {
      const data = event.data as { isTerminal?: boolean; message?: string };
      if (data.isTerminal) finish(last.trim() || `出错了：${data.message ?? '未知错误'}`);
    }
  });

  timer = setTimeout(() => {
    // abort 失败不拦收口（abort 后迟到的 done/error 会被 settled 挡掉）
    void session.abort().catch(() => undefined);
    finish(`这轮等太久了（超过 ${Math.round(timeoutMs / 60_000)} 分钟），已中断。请重新发一次；若常超时，换个更快的模型。`);
  }, timeoutMs);

  return {
    promise,
    dispose: () => finish(''),
  };
}
