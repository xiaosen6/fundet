/**
 * 钉钉知识库检索输出格式化（零依赖纯函数，node --test 直跑）。
 * 输入 = dws aisearch enterprise --format json 的 stdout：
 * result[] 每项 hostname=来源类型（文档/消息…）、snippet 含"目录:/标题:/内容:"。
 */
export interface KnowledgeToolOutputLike {
  text: string;
  isError: boolean;
}

export function formatDingtalkResults(
  stdout: string,
  query: string,
  limit = 5,
): KnowledgeToolOutputLike {
  let parsed: { errorCode?: unknown; errorMsg?: unknown; result?: unknown };
  try {
    parsed = JSON.parse(stdout) as { errorCode?: unknown; errorMsg?: unknown; result?: unknown };
  } catch {
    return { text: '钉钉知识库检索输出解析失败（非 JSON）。可稍后重试。', isError: true };
  }
  if (parsed?.errorCode != null || parsed?.errorMsg) {
    const msg = String(parsed.errorMsg ?? parsed.errorCode);
    const hint = /auth|login|登录|token/i.test(msg) ? '（钉钉登录态可能失效——到钉钉工作台重新登录）' : '';
    return { text: `钉钉知识库检索失败：${msg}${hint}`, isError: true };
  }
  const rows = Array.isArray(parsed?.result) ? (parsed.result as Array<Record<string, unknown>>) : [];
  if (rows.length === 0) {
    return { text: `钉钉侧没有找到与「${query}」相关的内容。请如实告知未命中，不要编造。`, isError: false };
  }
  const body = rows.slice(0, Math.min(limit, 10)).map((r, i) => {
    const host = typeof r.hostname === 'string' ? r.hostname : '钉钉';
    const snippet = typeof r.snippet === 'string' ? r.snippet.replace(/\s+/g, ' ').slice(0, 500) : '';
    return `【${i + 1}】来源：钉钉·${host}\n${snippet}`;
  }).join('\n\n');
  return {
    text: `钉钉知识库「${query}」命中 ${Math.min(rows.length, limit)} 条：\n\n${body}\n\n引用时注明来自钉钉·{来源类型}；未覆盖部分如实说明。`,
    isError: false,
  };
}
