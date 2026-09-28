/**
 * PetWindow —— 桌宠状态配置（混合动画模式）。
 *
 * 生图 sheet 的整段动作一致性无法达到逐帧轮播标准（帧间姿态差异仍偏大，
 * 轮播会"闪"），因此：
 * - idle / thinking：单帧 + 代码动画（呼吸缩放 / 轻微摇摆），数学连续绝对平滑；
 * - notify：保留 11 帧真轮播（蹲跳挥手是动作分解，帧间连续，单次播放表现力好）；
 * - blink：闭眼帧插播 150ms。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify';

export interface PetStateVisual {
  frames: string[];
  /** 帧间隔 ms（单帧状态无意义） */
  interval: number;
  loop: boolean;
  /** 单帧状态的代码动画：呼吸缩放 / 轻微摇摆 */
  anim?: 'breath' | 'sway';
  /** 一次性状态定长（ms）；notify 用 loop=false 播完即回 */
  duration?: number;
  fallback?: PetStateId;
}

const frame = (name: string): string => `./pet/sprites/${name}.png`;
const frames = (name: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `./pet/sprites/${name}_${String(i).padStart(2, '0')}.png`);

export const PET_STATES: Record<PetStateId, PetStateVisual> = {
  idle: { frames: [frame('idle_08')], interval: 0, loop: true, anim: 'breath' },
  blink: {
    frames: [frame('blink_01')],
    interval: 150,
    loop: false,
    duration: 150,
    fallback: 'idle',
  },
  thinking: { frames: [frame('thinking_00')], interval: 0, loop: true, anim: 'sway' },
  notify: { frames: frames('notify', 11), interval: 80, loop: false, fallback: 'idle' },
};

/** 正弦漂浮参数 */
export const FLOAT_AMPLITUDE = 6;
export const FLOAT_PERIOD = 2500;
/** 尺寸（逻辑 px） */
export const PET_SIZE = 128;
