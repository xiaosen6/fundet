/**
 * 知识库分块：段落聚合到目标长度，超长段落按句子切窗并带尾重叠。
 * 纯函数，参数即产品可调项（M1 常量默认，后续接设置面）。
 */

export interface TextChunk {
  /** 该文档内第几块，从 1 起 */
  ord: number;
  text: string;
}

export interface ChunkOptions {
  /** 目标块长度（字符），默认 800 */
  size?: number;
  /** 相邻块重叠（字符），默认 120 */
  overlap?: number;
}

const SENTENCE_SPLIT = /(?<=[。！？!?；;\n])/;

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(SENTENCE_SPLIT)
    .map((s) => s)
    .filter((s) => s.trim().length > 0);
}

export function chunkText(text: string, opts?: ChunkOptions): TextChunk[] {
  const size = opts?.size ?? 800;
  const overlap = opts?.overlap ?? 120;
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];

  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  };

  for (const para of paragraphs) {
    if (para.length > size) {
      // 超长段落：按句子打包，句间不断；带 overlap 尾句衔接
      flush();
      const sentences = splitSentences(para);
      let window = '';
      for (const sentence of sentences) {
        if (window.length + sentence.length > size && window) {
          out.push(window.trim());
          window = window.slice(Math.max(0, window.length - overlap));
        }
        window += sentence;
      }
      if (window.trim()) out.push(window.trim());
      continue;
    }
    if (buf.length + para.length + 2 > size && buf) {
      flush();
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  return out.map((t, i) => ({ ord: i + 1, text: t }));
}

/** 命中片段：在原文里找第一个词的位置，取前后窗口（bigram 是原文子串，可直接定位） */
export function buildSnippet(
  text: string,
  terms: string[],
  radius = 130,
): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  let first = -1;
  let termLen = 0;
  for (const term of terms) {
    if (!term) continue;
    const idx = clean.indexOf(term);
    if (idx >= 0 && (first < 0 || idx < first)) {
      first = idx;
      termLen = term.length;
    }
  }
  if (first < 0) return clean.slice(0, radius * 2) + (clean.length > radius * 2 ? '…' : '');
  const start = Math.max(0, first - radius);
  const end = Math.min(clean.length, first + termLen + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}
