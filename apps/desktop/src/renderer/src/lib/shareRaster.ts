/**
 * 分享卡片光栅化（上游 #4544 同款思路）：DOM → PNG（html-to-image，SVG
 * foreignObject 光栅化，全程不依赖窗口焦点/可见性——治 capturePage 在窗口
 * 最小化/遮挡时截空图）→ 主进程原生剪贴板（clipboard.writeImage，带 PNG
 * 魔数与尺寸校验）。
 *
 * web 字体（Inter/KaTeX）必须内联进 SVG，否则渲染回退系统字体；字体 CSS
 * 收集一次后模块级缓存（对齐 Cindy rasterizeToImage）。
 */
import { getFontEmbedCSS, toBlob } from 'html-to-image';

let fontEmbedCssCache: string | null = null;

async function fontEmbedCss(el: HTMLElement): Promise<string | undefined> {
  if (fontEmbedCssCache !== null) return fontEmbedCssCache || undefined;
  try {
    fontEmbedCssCache = await getFontEmbedCSS(el);
  } catch {
    // 字体内联失败：继续出图（回退系统字体的降级总好过失败）
    fontEmbedCssCache = '';
  }
  return fontEmbedCssCache || undefined;
}

/**
 * 把分享卡 DOM 复制成剪贴板 PNG（同一次写入带 text/plain 备选表示——
 * 聊天窗口吃图，纯文本框吃 Markdown 源码）。
 *
 * 光栅化抛错（卡内 longma-file:// / blob 图片、冷门 CSS 特性）时回落旧
 * capturePage 链路（窗口可见时可用；该路径没有纯文本备选表示）。
 */
export async function copyNodeAsPng(el: HTMLElement, plainText?: string): Promise<void> {
  try {
    const style = getComputedStyle(el);
    const blob = await toBlob(el, {
      pixelRatio: 2,
      backgroundColor: style.backgroundColor || '#faf6f0',
      fontEmbedCSS: await fontEmbedCss(el),
    });
    if (!blob) throw new Error('生成图片失败');
    const png = await blob.arrayBuffer();
    await window.fundet.copyPngToClipboard(png, plainText);
  } catch (err) {
    console.warn('[share] DOM 光栅化失败，回落窗口截图', err);
    const r = el.getBoundingClientRect();
    await window.fundet.copyImageRect({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
}
