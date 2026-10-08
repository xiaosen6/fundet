/**
 * 提示词模板共享契约：类型 + composer 插入的 DOM 事件协议。
 * 模板数据经 window.fundet.listPromptTemplates 取；插入时调 dispatchPromptInsert
 * 在 window 上广播，composer（ChatInput 集成方）用 onPromptInsert 监听并写入输入框。
 */

export interface PromptTemplateView {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** 手动序（小者靠前）；v1 不开放排序，恒 0 */
  sort: number;
}

export interface PromptTemplateInput {
  /** 空/null = 新建；带 id = 编辑（不存在时报错） */
  id?: string | null;
  title: string;
  content: string;
}

/** composer 插入自定义事件名（window 上派发） */
export const PROMPT_TEMPLATE_INSERT_EVENT = 'fundet:prompt-insert';

export interface PromptInsertDetail {
  /** 要插入输入框的文本 */
  text: string;
  /** 来源模板 id（可选） */
  templateId?: string;
}

/** 广播插入请求（renderer 侧用；非浏览器环境静默） */
export function dispatchPromptInsert(text: string, templateId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PromptInsertDetail>(PROMPT_TEMPLATE_INSERT_EVENT, {
      detail: { text, templateId },
    }),
  );
}

/** composer 侧监听插入请求；返回解订阅函数 */
export function onPromptInsert(cb: (detail: PromptInsertDetail) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event): void => cb((e as CustomEvent<PromptInsertDetail>).detail);
  window.addEventListener(PROMPT_TEMPLATE_INSERT_EVENT, handler);
  return () => window.removeEventListener(PROMPT_TEMPLATE_INSERT_EVENT, handler);
}
