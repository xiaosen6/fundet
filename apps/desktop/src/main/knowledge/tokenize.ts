/**
 * 知识库分词：CJK 双字切分（bigram）+ 拉丁词整取。
 *
 * 为什么不用 Intl.Segmenter：其词典数据在不同运行环境深浅不一（本机 Node 把
 * 「退货」切成单字），行为不一致；bigram 是确定性的纯函数——索引与查询两侧
 * 用同一函数，中文双字词可命中，长词由相邻 bigram 的 OR 覆盖。
 *
 * 形态约定（FTS5 unicode61 分词器对空格切词）：
 * - 索引文本 = 全部 token 以空格连接；
 * - 查询表达式 = `"tok1" OR "tok2" OR …`（拉丁词带前缀 `*`）。
 */

/** CJK 文字区（假名/汉/谚文及扩展区，排除 CJK 标点与全角符号） */
function isCjk(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) || // 平假名/片假名
    (code >= 0x3400 && code <= 0x9fff) || // CJK 扩展 A + 统一表意
    (code >= 0xac00 && code <= 0xd7af) || // 谚文
    (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
    (code >= 0x20000 && code <= 0x2fa1f) // 扩展 B-F
  );
}

/** 拉丁/数字词字符（欧文重音字母一并算词内） */
function isWordChar(ch: string): boolean {
  return /[0-9A-Za-z_]/.test(ch) || (ch.codePointAt(0)! < 0x2e80 && /\p{L}/u.test(ch));
}

interface Token {
  text: string;
  cjk: boolean;
}

/** 文本 → token 序列：CJK 连续段做重叠 bigram（单字自成 token），拉丁/数字连续段整取小写 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const push = (t: string, cjk: boolean): void => {
    if (t) tokens.push({ text: t, cjk });
  };
  let i = 0;
  const chars = [...text];
  while (i < chars.length) {
    const code = chars[i]!.codePointAt(0) ?? 0;
    if (/\s/.test(chars[i]!)) {
      i += 1;
      continue;
    }
    if (isCjk(code)) {
      let j = i;
      while (j < chars.length && isCjk(chars[j]!.codePointAt(0) ?? 0)) j += 1;
      const run = chars.slice(i, j);
      if (run.length === 1) push(run[0]!, true);
      else for (let k = 0; k + 1 < run.length; k++) push(run[k]! + run[k + 1]!, true);
      i = j;
      continue;
    }
    let j = i;
    while (j < chars.length && isWordChar(chars[j]!)) {
      j += 1;
    }
    if (j === i) {
      // 既非 CJK、非词、非空白（标点/符号）：跳过
      i += 1;
      continue;
    }
    push(chars.slice(i, j).join('').toLowerCase(), false);
    i = j;
  }
  return tokens;
}

/** 索引侧：正文 → 空格连接的 token 串（存入 FTS5 的 seg 列） */
export function indexText(text: string): string {
  return tokenize(text)
    .map((t) => t.text)
    .join(' ');
}

/** 查询侧：用户原话 → FTS5 MATCH 表达式（OR 连接，拉丁词前缀匹配） */
export function matchExpression(query: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  return tokens
    .map((t) => (t.cjk ? `"${t.text}"` : `"${t.text}"*`))
    .join(' OR ');
}

/** 查询 token 原文（片段定位用：bigram 是原文的子串，可直接 indexOf） */
export function queryTerms(query: string): string[] {
  return tokenize(query).map((t) => t.text);
}
