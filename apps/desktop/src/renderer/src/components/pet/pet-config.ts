/**
 * PetWindow —— 桌宠状态配置。
 *
 * 素材为独立生成的单帧姿势（帧间不连贯，多帧轮播必然抖动），
 * 动画改为「单帧 + 代码驱动」：呼吸/摇摆/弹跳由 RAF 数学连续驱动，绝对平滑。
 */

export type PetStateId = 'idle' | 'blink' | 'thinking' | 'notify';

export interface PetStateVisual {
  /** 主帧（sprites 目录相对路径） */
  frame: string;
  /** 状态内动画：呼吸缩放 / 轻微摇摆 / 弹跳 */
  anim: 'breath' | 'sway' | 'bounce';
  /** 一次性状态自动回落时长（ms）；不设则长驻（由状态桥驱动切换） */
  duration?: number;
  /** 一次性状态播完回落到的状态 */
  fallback?: PetStateId;
}

const frame = (name: string): string => `./pet/sprites/${name}.png`;

export const PET_STATES: Record<PetStateId, PetStateVisual> = {
  idle: { frame: frame('idle_00'), anim: 'breath' },
  // 眨眼：插播闭眼帧片刻后回 idle
  blink: { frame: frame('blink_01'), anim: 'breath', duration: 150, fallback: 'idle' },
  thinking: { frame: frame('thinking_00'), anim: 'sway' },
  // 通知：挥手帧弹跳约 1.2s 后回 idle
  notify: { frame: frame('notify_03'), anim: 'bounce', duration: 1200, fallback: 'idle' },
};

/** 正弦漂浮参数 */
export const FLOAT_AMPLITUDE = 6;
export const FLOAT_PERIOD = 2500;
/** 状态切换交叉淡化时长 ms（pet.html 的 transition 需与此一致） */
export const FADE_MS = 80;
/** 尺寸（逻辑 px） */
export const PET_SIZE = 128;
