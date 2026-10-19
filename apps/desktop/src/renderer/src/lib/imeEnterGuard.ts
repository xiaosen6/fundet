/**
 * CJK 输入法 Enter 守卫（CDS 手册 3.3 精确审计版，纯逻辑核心 + 薄 React 适配）。
 *
 * 既有防线：isComposing / keyCode===229 双重互锁（0.3.47 已接）。本模块补齐
 * WebKit 特有竞态：候选词上屏触发 compositionend 后，浏览器还会派发一个
 * **合成的 keydown Enter**（isComposing=false）——用户只是确认了汉字，消息却被
 * 误发送。对策：compositionend 起 500ms 内的裸 Enter 视为组词尾音，不发送，
 * 并用 capture 阶段 beforeinput 拦截 insertParagraph/insertLineBreak（防拦下的
 * Enter 仍插进换行）。Shift+Enter（显式换行）不受影响。
 *
 * 仅 WebKit 生效（Chromium 的 compositionend 不产生合成 Enter）——通过
 * vendor 注入判定，Electron/Chrome 恒 false、零行为变化。
 */

export const IME_POST_COMPOSITION_GUARD_MS = 500;

/** WebKit 判定（navigator.vendor 含 'Apple'）。注入式，测试可覆盖。 */
export function isWebKitEngine(vendor: string | undefined): boolean {
  return typeof vendor === 'string' && vendor.includes('Apple');
}

export interface EnterGuardDecisionInput {
  key: string;
  shiftKey?: boolean;
  isComposing: boolean;
  keyCode?: number;
  /** compositionend 的时间戳（ms）；null=本组件未见组词 */
  compositionEndedAt: number | null;
  now: number;
  /** WebKit 引擎（决定 500ms 窗口是否启用） */
  webkit: boolean;
}

export type EnterGuardDecision =
  | { action: 'pass' }
  /** 组词中/229：整键放行给输入法（连 beforeinput 都不碰） */
  | { action: 'yield-to-ime' }
  /** 组词后 500ms 内的合成 Enter：不发送，且要拦 beforeinput 换行 */
  | { action: 'block-and-swallow-newline' };

export function decideEnterGuard(input: EnterGuardDecisionInput): EnterGuardDecision {
  const { key, isComposing, keyCode, compositionEndedAt, now, webkit, shiftKey } = input;
  if (key !== 'Enter') return { action: 'pass' };
  if (isComposing || keyCode === 229) return { action: 'yield-to-ime' };
  if (shiftKey) return { action: 'pass' };
  if (
    webkit &&
    compositionEndedAt !== null &&
    Math.abs(now - compositionEndedAt) < IME_POST_COMPOSITION_GUARD_MS
  ) {
    return { action: 'block-and-swallow-newline' };
  }
  return { action: 'pass' }
}

/** 拦截窗口内的 beforeinput：只吃段落/换行插入（其它输入类型不碰）。 */
export function isGuardedNewlineInsert(inputType: string): boolean {
  return inputType === 'insertParagraph' || inputType === 'insertLineBreak';
}
