/**
 * 首条消息 → 会话标题。保留用户原意，但不让 Markdown 结构符占满标题，
 * 并按 Unicode 码点截断，避免把 emoji 的代理对切成乱码。
 */

const MAX_TITLE_CODEPOINTS = 20;

export function autoSessionTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  // 去掉只起排版作用的首尾围栏与行首标记；正文里的路径/命令不动。
  const text = collapsed
    .replace(/^```[\w-]*\s*/, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:#{1,6}|>)\s+/, '')
    .trim();

  // 「---」「```」「???」这类零信息内容不值得覆盖「新对话」占位。
  // 字母/数字/CJK/emoji 均可成为有效标题，不能只认 ASCII。
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) return '';
  return Array.from(text).slice(0, MAX_TITLE_CODEPOINTS).join('');
}
