/**
 * 预览能力 URL hook：longma-file 地址改由主进程签发（fs:create-preview-url），
 * 渲染层不再自行拼造。三态：pending（不发「不在工作目录」误报）/ ready / denied。
 *
 * 竞态防护：慢响应不覆盖新目标（序列号丢弃过期结果）；path/workDir 变化重签。
 * HTML 轮末刷新场景由调用方在 key 里拼 reloadKey，无需重签（同一文件 token 幂等）。
 */
import { useEffect, useState } from 'react';

export type PreviewUrlState =
  | { status: 'pending'; url: null }
  | { status: 'ready'; url: string }
  | { status: 'denied'; url: null; error: string };

export function useFilePreviewUrl(
  filePath: string | null | undefined,
  workDir?: string,
): PreviewUrlState {
  const [state, setState] = useState<PreviewUrlState>({ status: 'pending', url: null });

  useEffect(() => {
    if (!filePath || !filePath.trim()) {
      setState({ status: 'pending', url: null });
      return;
    }
    let seq = 0;
    const current = ++seq;
    setState({ status: 'pending', url: null });
    void window.fundet
      .createPreviewUrl(filePath, workDir)
      .then((url) => {
        if (current === seq) setState({ status: 'ready', url });
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
