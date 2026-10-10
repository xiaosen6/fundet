/**
 * Office 文件预览纯逻辑（node --test 直测，无 DOM / React 依赖）。
 * - dataUrlToBytes：readFileDataUrl 返回的 data:base64 → Uint8Array
 * - sanitizeOfficeHtml：mammoth 输出后的防御性清洗（dangerouslySetInnerHTML 前一道闸）
 * - extractPptxSlideTexts：pptx 包内 ppt/slides/slideN.xml → 每页文本行
 */

/** data:URL（readFileDataUrl 返回）解包为 Uint8Array；非 base64 data:URL 抛错。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('不是 data: URL');
  if (!dataUrl.slice(5, comma).endsWith(';base64')) throw new Error('data: URL 不是 base64 编码');
  const bin = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 独立 ArrayBuffer 拷贝（mammoth 入参 {arrayBuffer}，不吃视图偏移）。 */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = bytes.slice();
  return copy.buffer as ArrayBuffer;
}

/**
 * mammoth 输出的标签集受限（无 script/style、无事件属性），这里仍做一道
 * 防御：剥 script/style 块与裸标签、on* 事件属性、javascript: 链接。
 * data: 内联图片是 mammoth 的合法产物，不动。
 */
export function sanitizeOfficeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<style\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(")\s*javascript:[^"]*(")/gi, 'href="#"')
    .replace(/(href|src)\s*=\s*(')\s*javascript:[^']*(')/gi, "href='#'");
}

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PARAGRAPH_RE = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
const LINE_BREAK_RE = /<a:br(?:\s[^>]*)?\/?>/;
const TEXT_RUN_RE = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;

/** 组件侧过滤用：只读 slide XML，不把整个包读成字符串。 */
export function isPptxSlidePath(path: string): boolean {
  return SLIDE_PATH_RE.test(path);
}

export interface PptxSlideText {
  /** slideN.xml 的 N（包内页序，非展示顺序文件名排序） */
  number: number;
  /** 每个文本段落一行；段落内 run 已合并、<a:br/> 分行 */
  lines: string[];
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 段落 XML → 文本行列表（run 合并、br 分行、实体解码、空白折叠）。 */
export function extractPptxParagraphLines(paragraphXml: string): string[] {
  const lines: string[] = [];
  for (const para of paragraphXml.matchAll(PARAGRAPH_RE)) {
    for (const segment of para[1].split(LINE_BREAK_RE)) {
      const runs: string[] = [];
      for (const run of segment.matchAll(TEXT_RUN_RE)) runs.push(decodeXmlEntities(run[1]));
      const line = runs.join('').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** zip 内 XML 路径 → 内容的映射 → 按页号排序的每页文本。 */
export function extractPptxSlideTexts(zipXmlMap: Record<string, string>): PptxSlideText[] {
  const slides: PptxSlideText[] = [];
  for (const [path, xml] of Object.entries(zipXmlMap)) {
    const m = SLIDE_PATH_RE.exec(path);
    if (!m) continue;
    slides.push({ number: Number(m[1]), lines: typeof xml === 'string' ? extractPptxParagraphLines(xml) : [] });
  }
  slides.sort((a, b) => a.number - b.number);
  return slides;
}
