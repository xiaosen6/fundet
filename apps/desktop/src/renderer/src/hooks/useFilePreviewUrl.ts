/**
 * 预览能力 URL hook：longma-file 地址改由主进程签发（fs:create-preview-url），
 * 渲染层不再自行拼造。三态：pending（不发「不在工作目录」误报）/ ready / denied。
 *
 * 竞态防护：慢响应不覆盖新目标（序列号丢弃过期结果）；path/workDir 变化重签。
 * HTML 轮末刷新场景由调用方在 key 里拼 reloadKey，无需重签（同一文件 token 幂等）。
 *
 * URL 缓存（2026-11-24 闪烁根因修复）：能力 token 按真实路径幂等——同一路径
 * 重签结果一样。虚拟化行滚出窗口卸载、滚回来重挂时，若无缓存，每次都走
 * pending（「加载图片…」矮行）→ IPC 回来 ready（图片高行），行高在两态间
 * 弹跳 → 虚拟化重排 → 行又被挤出窗口 → 无限循环 = 整页闪烁。缓存后重挂
 * 立即拿到 ready，高度不跳，循环断掉。
 */
import { useEffect, useState } from 'react';

export type PreviewUrlState =
  | { status: 'pending'; url: null }
  | { status: 'ready'; url: string }
  | { status: 'denied'; url: null; error: string };

/** 模块级路径→URL 缓存（token 按路径幂等，跨组件实例/跨重挂稳定） */
const urlCache = new Map<string, string>();
const URL_CACHE_MAX = 256;

function cacheUrl(path: string, url: string): void {
  if (urlCache.size >= URL_CACHE_MAX) {
    const oldest = urlCache.keys().next().value;
    if (oldest !== undefined) urlCache.delete(oldest);
  }
  urlCache.set(path, url);
}

export function useFilePreviewUrl(
  filePath: string | null | undefined,
  workDir?: string,
): PreviewUrlState {
  const [state, setState] = useState<PreviewUrlState>(() => {
    // 初始即查缓存：重挂场景直接 ready，不走 pending
    if (filePath && filePath.trim()) {
      const cached = urlCache.get(filePath);
      if (cached) return { status: 'ready', url: cached };
    }
    return { status: 'pending', url: null };
  });

  useEffect(() => {
    if (!filePath || !filePath.trim()) {
      setState({ status: 'pending', url: null });
      return;
    }
    // 缓存命中：不再发 IPC（同路径 token 幂等，重签浪费且触发 pending↔ready 弹跳）
    const cached = urlCache.get(filePath);
    if (cached) {
      setState({ status: 'ready', url: cached });
      return;
    }
    let seq = 0;
    const current = ++seq;
    setState({ status: 'pending', url: null });
    void window.fundet
      .createPreviewUrl(filePath, workDir)
      .then((url) => {
        if (current === seq) {
          cacheUrl(filePath, url);
          setState({ status: 'ready', url });
        }
      })
      .catch((err: unknown) => {
        if (current === seq) {
          setState({
            status: 'denied',
            url: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      seq++;
    };
  }, [filePath, workDir]);

  return state;
}
