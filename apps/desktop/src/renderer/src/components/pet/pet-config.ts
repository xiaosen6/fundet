/**
 * PetWindow —— 桌宠状态配置（慢速有限动画）。
 *
 * 快速轮播会放大生图帧间的微小差异（观感"闪"），因此循环类状态用
 * 「相邻帧子集 + 慢速 ping-pong + 长过渡」的有限动画技法：
 * 微小帧差在慢速下呈现为自然的小动作；notify 单次动作保持快速轮播。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify';

export interface PetStateVisual {
  frames: string[];
  /** 帧间隔 ms */
  interval: number;
  loop: boolean;
  /** 往复播放（到尾帧后倒放回起点，消除循环跳变） */
  pingpong?: boolean;
  /** 帧间交叉淡化 ms（默认 40） */
  fadeMs?: number;
  /** 叠加的代码动画：呼吸缩放 / 轻微摇摆 */
  anim?: 'breath' | 'sway';
  /** 一次性状态定长（ms）；notify 用 loop=false 播完即回 */
  duration?: number;
  fallback?: PetStateId;
}

const frames = (name: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `./pet/sprites/${name}_${String(i).padStart(2, '0')}.png`);

export const PET_STATES: Record<PetStateId, PetStateVisual> = {
  // idle 取垂手组 5 帧（11 帧中 6-10），慢速往复 = 自然的小幅活动
  idle: {
    frames: frames('idle', 11).slice(6, 11),
    interval: 520,
    loop: true,
    pingpong: true,
    fadeMs: 320,
    anim: 'breath',
  },
  blink: {
    frames: ['./pet/sprites/blink_01.png'],
    interval: 150,
    loop: false,
    duration: 150,
    fallback: 'idle',
  },
  // thinking 取摸下巴组前 5 帧，慢速往复 + 摇摆
  thinking: {
    frames: frames('thinking', 10).slice(0, 5),
    interval: 600,
    loop: true,
    pingpong: true,
    fadeMs: 320,
    anim: 'sway',
  },
  // notify 是蹲跳挥手的动作分解，快速单次轮播
  notify: { frames: frames('notify', 11), interval: 80, loop: false, fadeMs: 40, fallback: 'idle' },
};

/** 正弦漂浮参数 */
export const FLOAT_AMPLITUDE = 6;
export const FLOAT_PERIOD = 2500;
/** 尺寸（逻辑 px） */
export const PET_SIZE = 128;
