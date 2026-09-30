/**
 * 生图工具实现：generate_image → provider 生图 → 落盘到会话工作目录。
 * 依赖注入（node --test 可测）；文件落盘走真实 fs（调用方在 main 进程）。
 */
import type { ImageGenProvider } from './gateway.ts';
import type { ImageGenRequest, ImageGenResult } from '../../shared/imagegen.ts';

export interface ImagegenToolOutput {
  text: string;
  isError: boolean;
}

export interface ImagegenDeps {
  provider: Pick<ImageGenProvider, 'generate'>;
  /** 图片落盘：返回相对工作目录的路径（如 fundet-images/image-143201-a1b2.png） */
  saveImage(workdir: string, result: ImageGenResult, prompt: string): Promise<string>;
  /** 本会话工作目录 */
  workingDir: string;
}

/** 尺寸校验：宽高各 256..3072（网关可持续上限见 memory.md §4.11） */
function parseSize(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(v.trim());
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w < 256 || h < 256 || w > 3072 || h > 3072) return null;
  return `${w}x${h}`;
}

/** prompt → 文件名片段（拉丁/数字；中文 prompt 榨不出就用时间戳兜底） */
export function slugOf(prompt: string): string {
  const s = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s || 'image';
}

export function createImagegenHandlers(deps: ImagegenDeps) {
  const handleGenerateImage = async (args: Record<string, unknown>): Promise<ImagegenToolOutput> => {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      return { text: 'INVALID_PARAMS：缺少 prompt（要画什么的描述）', isError: true };
    }
    const size = args.size === undefined ? '1024x1024' : parseSize(args.size);
    if (!size) {
      return {
        text: 'INVALID_PARAMS：size 格式为 宽x高（如 1024x1024 / 1280x720），边长 256..3072',
        isError: true,
      };
    }
    try {
      // 1024² 约 30s、3072x1024 可到 ~2 分钟——timeout 给足 5 分钟
      const result = await deps.provider.generate({ prompt, size } satisfies ImageGenRequest, 300_000);
      const rel = await deps.saveImage(deps.workingDir, result, prompt);
      return {
        text:
          `图片已生成并保存到工作目录：${rel}（${size}）。` +
          `请把文件路径告诉用户，用户可在 Canvas/资源管理器中查看。`,
        isError: false,
      };
    } catch (err) {
      return {
        text: `生图失败：${err instanceof Error ? err.message : String(err)}。` +
          `多为生图服务繁忙或未就绪，可稍后重试或减小尺寸。`,
        isError: true,
      };
    }
  };

  return { generateImage: handleGenerateImage, slugOf };
}
