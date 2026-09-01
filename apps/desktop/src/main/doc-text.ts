/**
 * 文档正文提取：PDF / Word 拖入会话时，发送前在主进程把正文抽成纯文本随消息发给模型。
 * pi 的 read 工具只能读纯文本，直接读二进制文档是乱码；提取失败不阻断发送，
 * 只附一句说明让模型知道（而不是假装读了）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 单篇文档提取上限：防超长 PDF 把上下文打爆 */
const MAX_CHARS = 200_000;
/** 文件超过该大小直接不提取（扫描件合集/画册类大多这个量级） */
const MAX_BYTES = 30 * 1024 * 1024;

export function documentExtractSupport(
  filePath: string,
): 'pdf' | 'docx' | 'doc-legacy' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc-legacy';
  return null;
}

async function extractPdf(filePath: string): Promise<string> {
  // unpdf = pdfjs 的 Node 封装，自带 DOMMatrix 等浏览器 API polyfill
  // （裸 pdfjs 在 Node 里提文本会炸 DOMMatrix is not defined）
  const { extractText } = await import('unpdf');
  const result = await extractText(new Uint8Array(fs.readFileSync(filePath)));
  return result.text.join('\n\n');
}

async function extractDocx(filePath: string): Promise<string> {
  // mammoth 是 CJS，默认导入再解构（命名导入在 ESM 静态分析下会炸，同 electron-updater 坑）
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

/**
 * 提取文档正文。返回带说明的文本块（成功/空文字层/不支持/失败各一句），
 * 调用方直接拼进用户消息。抛错只用于调用方自身bug，正常失败都收口为文本。
 */
export async function extractDocumentText(filePath: string): Promise<string> {
  const kind = documentExtractSupport(filePath);
  const name = path.basename(filePath);
  if (kind === 'doc-legacy') {
    return `附件「${name}」是老式 .doc 格式，暂不支持提取正文，请用户另存为 .docx 后重发。`;
  }
  if (!kind) return '';
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BYTES) {
      return `附件「${name}」体积过大（${Math.round(stat.size / 1024 / 1024)}MB），未提取正文。`;
    }
    const raw = kind === 'pdf' ? await extractPdf(filePath) : await extractDocx(filePath);
    const text = raw.replace(/[ \t]+\n/g, '\n').trim();
    if (!text) {
      return `附件「${name}」没有可提取的文字层（可能是扫描件/图片型文档），无法读取正文。`;
    }
    const truncated = text.length > MAX_CHARS;
    const body = truncated ? `${text.slice(0, MAX_CHARS)}\n\n（正文过长，已截断）` : text;
    return `以下是附件「${name}」的正文提取：\n\n${body}`;
  } catch (err) {
    return `附件「${name}」正文提取失败：${err instanceof Error ? err.message : String(err)}。文件已在工作目录内，可用其它方式处理。`;
  }
}
