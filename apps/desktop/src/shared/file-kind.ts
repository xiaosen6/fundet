/**
 * 本地文件预览 / 附件分类（无 Node API，main 与 renderer 共用）。
 */

export type FileKind = 'image' | 'video' | 'audio' | 'html' | 'pdf' | 'markdown' | 'text' | 'other';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogv', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.wma']);
const HTML_EXT = new Set(['.html', '.htm', '.xhtml']);
const PDF_EXT = new Set(['.pdf']);
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx']);
const TEXT_EXT = new Set([
  '.txt',
  '.json',
  '.csv',
  '.tsv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.scss',
  '.less',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.log',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.r',
  '.lua',
  '.diff',
  '.patch',
  '.lock',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
};

/** 作为多模态 image block 发给模型的上限；更大的图改走路径引用。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function extOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/');
  const slash = base.lastIndexOf('/');
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function fileKind(filePath: string): FileKind {
  const e = extOf(filePath);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (HTML_EXT.has(e)) return 'html';
  if (PDF_EXT.has(e)) return 'pdf';
  if (MARKDOWN_EXT.has(e)) return 'markdown';
  if (TEXT_EXT.has(e)) return 'text';
  return 'other';
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXT.has(extOf(filePath.trim()));
}

export function mimeFromExt(extOrPath: string): string {
  const e = extOrPath.startsWith('.') ? extOrPath.toLowerCase() : extOf(extOrPath);
  return MIME_BY_EXT[e] ?? 'application/octet-stream';
}

/** Pi UserMessage：图走 image block，其余走 file 路径引用。 */
export function sendBlockKind(filePath: string, size?: number): 'image' | 'file' {
  if (!isImagePath(filePath)) return 'file';
  if (typeof size === 'number' && size > MAX_IMAGE_BYTES) return 'file';
  return 'image';
}

/**
 * 图片真实格式嗅探（魔数）：QQ 等聊天软件的"原图"经常是 PNG 套 .jpeg 扩展名，
 * 按扩展名声明的 mime 与字节不符时严格的多模态端点会拒收。识别不了回落扩展名。
 */
export function sniffImageMime(head: Uint8Array, fallbackFromExt: string): string {
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (head.length >= 12 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return 'image/webp'; // RIFF....WEBP
  }
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    return 'image/gif'; // GIF8
  }
  // ftyp 容器（avif/heic）brand 变多，按扩展名声明更稳
  return fallbackFromExt;
}
