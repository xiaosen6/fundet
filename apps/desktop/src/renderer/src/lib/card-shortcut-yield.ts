/**
 * 键盘快捷键的「让位」判据（Cindy #5256 手工移植，2026-09-30）。
 *
 * 替代输入框的交互卡片（审批 / 提问）在 window 上挂了回车 / Esc / 数字键快捷键。
 * 这些按键同时可能属于别处：焦点所在的按钮、刚打开的菜单、正在打字的输入框。
 * 快捷键只在按键确实「无人认领」时才替用户做决定，否则让位——焦点在「拒绝」上
 * 按回车必须还是拒绝；在侧栏搜索里打数字不能选中提问选项；Esc 关下拉不能顺带
 * 拒绝审批。
 *
 * 决策核心（decideCardShortcutYield）与 DOM 适配（shouldCardShortcutYield）分离：
 * 前者纯函数可 node --test 直测，后者薄封装。
 */

export type CardShortcutKind = 'activate' | 'modifiedActivate' | 'dismiss' | 'character';

export interface CardShortcutDecisionInput {
  /** 按键已被别处处理（defaultPrevented）或输入法组字中 */
  alreadyHandled: boolean;
  /** 焦点在可编辑控件（input/textarea/select/contentEditable） */
  focusEditable: boolean;
  /** 事件目标位于菜单/弹层/对话框等自带 Esc/方向键语义的浮层内（卡片外） */
  inOutsideLayer: boolean;
  /** 事件目标是按钮/链接等自带键盘激活语义的控件 */
  focusInteractive: boolean;
  /** 事件目标在卡片自己的子树内 */
  insideOwner: boolean;
}

/** 让位决策表（Cindy #5256 语义，测试即规格） */
export function decideCardShortcutYield(input: CardShortcutDecisionInput, kind: CardShortcutKind): boolean {
  if (input.alreadyHandled) return true;
  if (input.focusEditable) return true;
  if (!input.focusInteractive) return input.inOutsideLayer;
  // 交互控件上：
  // - 卡片外的控件：让位（按键属于那个控件所在的界面）
  // - 卡片自己的控件：普通回车/空格让给控件原生激活（「拒绝」上回车=拒绝）；
  //   Esc 与数字键没有原生含义仍归卡片；带修饰键的组合键保留卡片语义
  return !input.insideOwner || kind === 'activate';
}

/** 焦点落在可编辑控件里时，全局快捷键不该抢走按键。 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

/** 自带键盘语义的控件：焦点在这里时，回车/空格由它自己激活。 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'select',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role^="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="treeitem"]',
].join(',');

/** 自己处理 Esc/方向键的浮层：菜单、下拉列表、弹层与对话框（Radix 弹层含在内）。 */
const LAYER_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

export function shouldCardShortcutYield(event: KeyboardEvent, kind: CardShortcutKind, owner: Element | null): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const target = event.target;
  if (isEditableKeyboardTarget(target)) return true;
  if (!(target instanceof Element)) return false;
  const insideOwner = owner?.contains(target) ?? false;
  return decideCardShortcutYield(
    {
      alreadyHandled: false,
      focusEditable: false,
      inOutsideLayer: !insideOwner && Boolean(target.closest(LAYER_SELECTOR)),
      focusInteractive: Boolean(target.closest(INTERACTIVE_SELECTOR)),
      insideOwner,
    },
    kind,
  );
}
