import { brand } from './brand.ts';
/**
 * 供应商/运行时错误的用户话术映射。原始报错（pi 透传的 HTTP 错误文本、
 * pi 子进程退出码）偏技术，常见几类有明确的用户行动项。
 */

/** pi（bun 单二进制）在 Windows 上的典型崩溃退出码 */
const PI_EXIT_HINTS: Array<{ code: number; hint: string }> = [
  {
    // 0xC000001D STATUS_ILLEGAL_INSTRUCTION：bun 标准 x64 构建需要 AVX/AVX2，
    // 老 CPU（约 2013 前 Intel / 2015 前 AMD）或部分虚拟机没有 → 启动即崩
    code: 3221225501,
    hint:
      '助手运行时（pi）无法在这台电脑上启动：CPU 缺少 AVX2 指令集（2013 年前的 Intel、2015 年前的 AMD 或部分虚拟机的典型情况）。' +
      ` ${brand.name} 依赖的 pi 运行时目前只有标准构建，这类机器暂时无法使用助手功能，请换用支持 AVX2 的电脑。`,
  },
  {
    // 0xC0000135 STATUS_DLL_NOT_FOUND：系统缺 DLL 或杀毒软件拦截
    code: 3221225781,
    hint:
      `助手运行时启动失败（缺少系统组件或被杀毒软件拦截）。请把 ${brand.name} 安装目录加入杀毒软件白名单后重试；仍失败请重装。`,
  },
  {
    // 0xC0000005 STATUS_ACCESS_VIOLATION：文件损坏或杀软干扰
    code: 3221225477,
    hint:
      `助手运行时异常崩溃（可能是文件损坏或杀毒软件干扰）。请重装 ${brand.name}，并把安装目录加入杀毒软件白名单后重试。`,
  },
];

export function friendlyError(raw: string): string {
  // pi process exited (code=3221225501, signal=null)
  const exitMatch = /pi process exited(?: unexpectedly)? \(code=(\d+),/.exec(raw);
  if (exitMatch) {
    const code = Number(exitMatch[1]);
    const hit = PI_EXIT_HINTS.find((h) => h.code === code);
    if (hit) return `${hit.hint}（退出码 ${code}）`;
    return `助手运行时异常退出（退出码 ${code}）。请重试；反复出现请把该码反馈给我们。`;
  }
  // 智谱 1210：messages.content.type 参数非法，取值范围 ['text']（模型非视觉）
  if (/content\.type/i.test(raw) && /\['text'\]|\"text\"/i.test(raw)) {
    return (
      '该模型不支持图片输入。请在 设置 → 模型供应商 里换用视觉模型' +
      '（如 glm-4v 系列、doubao vision 系列），或用模型行上的「视觉」开关修正后重试。'
    );
  }
  if (/max_tokens/i.test(raw) && /非法|限制|范围|invalid|range|maximum/i.test(raw)) {
    return (
      '该模型的最大输出（max_tokens）超出上限。请在 设置 → 模型供应商 编辑该模型，' +
      '调小 maxTokens 后重试。'
    );
  }
  return raw;
}

/** 兼容旧名（供应商错误映射） */
export const friendlyProviderError = friendlyError;
