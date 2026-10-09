/**
 * SESSION_EXPORT_HTML handler 纯逻辑：dialog/shell/会话取用依赖注入，便于
 * node --test 直测（register.ts 挂真实 electron 实现；本文件对 electron 仅
 * type import，运行时零依赖）。流程：校验 → 内存活会话检查 → 保存对话框 →
 * pi 原生 export_html 落盘 → 打开所在文件夹。
 */
import type { BrowserWindow } from 'electron';

/** 会话不在内存（或已关闭）时的统一文案：导出走 pi 侧转录，会话必须在运行中 */
export const SESSION_NOT_ALIVE_MESSAGE = '会话不在运行中，请先在该会话发送一条消息后再导出';

/** 依赖里只需要会话对象的导出能力（Session 的结构子集） */
export interface SessionHtmlExportTarget {
  exportSessionHtml(outputPath?: string): Promise<string>;
}

export interface SessionHtmlExportDeps {
  showSaveDialog: (
    parent: BrowserWindow | undefined,
    options: { title: string; defaultPath: string; filters: Array<{ name: string; extensions: string[] }> },
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  showItemInFolder: (fullPath: string) => void;
  /** 内存中的活会话（不在内存 / 已关闭 = undefined，与 maker.isSessionAlive 同口径） */
  getLiveSession: (sessionId: string) => SessionHtmlExportTarget | undefined;
}

/** 默认文件名：Fundet-会话-<sessionId 前 8 位>-<yyyyMMdd-HHmm>.html（now 可注入便于测试） */
export function buildSessionHtmlFileName(sessionId: string, now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const short = sessionId.replace(/[<>:"/\\|?*\s]/g, '').slice(0, 8) || 'session';
  return `Fundet-会话-${short}-${stamp}.html`;
}

/**
 * 导出会话为 HTML。返回 { path }；用户在保存对话框点取消返回 null（非错误）。
 * 会话不在内存 / 导出失败抛错（渲染层 toast 原文）。
 */
export function makeSessionHtmlExporter(
  deps: SessionHtmlExportDeps,
): (sessionId: string, parent?: BrowserWindow) => Promise<{ path: string } | null> {
  return async (sessionId, parent) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('参数缺失：sessionId');
    }
    const session = deps.getLiveSession(sessionId);
    if (!session) throw new Error(SESSION_NOT_ALIVE_MESSAGE);
    const picked = await deps.showSaveDialog(parent, {
      title: '导出会话为网页',
      defaultPath: buildSessionHtmlFileName(sessionId),
      filters: [{ name: 'HTML 网页', extensions: ['html'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    // 用 pi 返回的实际写出路径（引擎可能对路径做规范化/追加扩展名）
    const written = await session.exportSessionHtml(picked.filePath);
    deps.showItemInFolder(written);
    return { path: written };
  };
}
