/**
 * PetWindow —— 桌宠窗口（透明置顶小窗 + 帧动画引擎）。
 *
 * 透明无边框 + alwaysOnTop + skipTaskbar；点击穿透（forward hover）；
 * 帧动画 10FPS + 正弦漂浮 + 状态切换淡入；位置拖拽 + 贴边吸附 + localStorage 记忆。
 * 状态指令经 IPC pet:state 推送（PetStateBridge 驱动）。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify';

/** 状态配置：帧序列 + 循环/单次 + 帧间 ms（idle/thinking/notify 各 6 帧、blink 3 帧，与素材一致） */
export const PET_STATES: Record<PetStateId, {
  frames: string[];
  loop: boolean;
  interval: number;
  /** 单次播完回落到的状态 */
  fallback?: PetStateId;
}> = {
  idle: {
    frames: Array.from({ length: 6 }, (_, i) => `./pet/sprites/idle_${String(i).padStart(2, '0')}.png`),
    loop: true,
    interval: 140,
  },
  blink: {
    frames: Array.from({ length: 3 }, (_, i) => `./pet/sprites/blink_${String(i).padStart(2, '0')}.png`),
    loop: false,
    interval: 100,
    fallback: 'idle',
  },
  thinking: {
    frames: Array.from({ length: 6 }, (_, i) => `./pet/sprites/thinking_${String(i).padStart(2, '0')}.png`),
    loop: true,
    interval: 120,
  },
  notify: {
    frames: Array.from({ length: 6 }, (_, i) => `./pet/sprites/notify_${String(i).padStart(2, '0')}.png`),
    loop: false,
    interval: 110,
    fallback: 'idle',
  },
};

/** 眨眼随机插播间隔（ms） */
export const BLINK_MIN = 3000;
export const BLINK_MAX = 7000;
/** 正弦漂浮参数 */
export const FLOAT_AMPLITUDE = 6;
export const FLOAT_PERIOD = 2500;
/** 状态切换淡入时长 ms */
export const FADE_MS = 180;
/** 尺寸（逻辑 px） */
export const PET_SIZE = 128;
