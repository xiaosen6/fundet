/**
 * PetWindow —— 桌宠状态配置（终版：静止待机 + 偶发动作）。
 *
 * 生图帧间存在不可消除的本体形变（实测相邻帧 ~5000px 差异，平移配准无效），
 * 任何速度的轮播都会被感知为"闪"。因此待机/思考为静止帧 + 极轻浮动；
 * 生命感由偶发动作提供（随机眨眼、随机跳跃）；notify 单次动作保留快速轮播。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify' | 'running';

export interface PetStateVisual {
  frames: string[];
  /** 帧间隔 ms（仅多帧状态） */
  interval: number;
  loop: boolean;
  /** 帧间交叉淡化 ms（默认 40） */
  fadeMs?: number;
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
  // 拖动中：向右奔跑循环（向左拖时整体水平翻转），素材面朝右。
  // 素材 v2（2026-09-29）：纯 t2i 逐姿势生成（generations 端点无参考锚定，
  // 固定 seed 300+i + 文字锁形象 + 每帧一个明确步态相位句）——img2img 参考
  // 图会把手臂锚死在参考姿势上（rune/rund 两轮实证），t2i 才能真对侧摆。
  // 6 帧 @75ms 硬切（16ms 近无过渡），用户验收「腿迈开+手臂对侧摆」。
  running: {
    frames: frames('runf', 6),
    interval: 75,
    loop: true,
    fadeMs: 16,
  },
};

/** 待机偶发动作间隔（ms，随机区间） */
export const IDLE_BLINK_EVERY: [number, number] = [5000, 11000];
export const IDLE_HOP_EVERY: [number, number] = [15000, 30000];

/** 正弦漂浮参数（极轻——待机以静为主） */
export const FLOAT_AMPLITUDE = 3;
export const FLOAT_PERIOD = 3200;
