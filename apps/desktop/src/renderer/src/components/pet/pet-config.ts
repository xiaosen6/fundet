/**
 * PetWindow —— 桌宠状态配置（密集帧版）。
 *
 * 素材：网关 Qwen-Image-2.1 密集帧 sheet（帧间微小连续变化），内容感知切帧后
 * idle 11 帧 / thinking 10 帧 / notify 11 帧 / blink 闭眼帧 1 张。
 * idle/thinking 用 ping-pong 往复轮播（呼吸/摇摆类动作首尾自然相接）；
 * notify 单次播放后回落 idle；blink 为插播闭眼帧。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify';

export interface PetStateVisual {
  frames: string[];
  /** 帧间隔 ms */
  interval: number;
  loop: boolean;
  /** 往复播放（到尾帧后倒放回起点，消除循环跳变） */
  pingpong?: boolean;
  /** 一次性状态定长（ms，blink 用）；notify 用 loop=false 播完即回 */
  duration?: number;
  fallback?: PetStateId;
}

const frames = (name: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `./pet/sprites/${name}_${String(i).padStart(2, '0')}.png`);

export const PET_STATES: Record<PetStateId, PetStateVisual> = {
  idle: { frames: frames('idle', 11), interval: 110, loop: true, pingpong: true },
  blink: {
    frames: ['./pet/sprites/blink_01.png'],
    interval: 150,
    loop: false,
    duration: 150,
    fallback: 'idle',
  },
  thinking: { frames: frames('thinking', 10), interval: 120, loop: true, pingpong: true },
  notify: { frames: frames('notify', 11), interval: 80, loop: false, fallback: 'idle' },
};

/** 正弦漂浮参数 */
export const FLOAT_AMPLITUDE = 6;
export const FLOAT_PERIOD = 2500;
/** 尺寸（逻辑 px） */
export const PET_SIZE = 128;
