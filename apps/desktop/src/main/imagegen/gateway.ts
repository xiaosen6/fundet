/**
 * 生图 provider 层：v1 只有自建网关（Qwen-Image-2.1）。
 *
 * 接入其他生图服务时：实现 ImageGenProvider 接口并加进 providers 数组，
 * 工具面/桥接/审批全部不动。网关生图的参数坑见 memory.md §4.11（生图管线
 * v2 记档：~30s/张 1024²、可持续上限 3072x1024/60 步、未知参数静默忽略）。
 */
import { gatewayUrl } from '../host/service-gateway.ts';
import type { ImageGenRequest, ImageGenResult } from '../../shared/imagegen.ts';

export interface ImageGenProvider {
  id: string;
  label: string;
  generate(req: ImageGenRequest, timeoutMs: number): Promise<ImageGenResult>;
}

/** 自建网关：POST {gatewayUrl}/v1/images/generations（OpenAI 形状，b64_json 返回） */
class GatewayImageGenProvider implements ImageGenProvider {
  readonly id = 'gateway';
  readonly label = '内置生图服务';

  async generate(req: ImageGenRequest, timeoutMs: number): Promise<ImageGenResult> {
    const res = await fetch(`${gatewayUrl()}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen-Image-2.1',
        prompt: req.prompt,
        size: req.size,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`生图服务失败（HTTP ${res.status}）：${detail}`);
    }
    const j = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = j.data?.[0];
    if (item?.b64_json) {
      return { bytes: new Uint8Array(Buffer.from(item.b64_json, 'base64')) };
    }
    // 兜底 url 形态：拉回来
    if (item?.url) {
      const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new Error(`生图结果下载失败（HTTP ${img.status}）`);
      return { bytes: new Uint8Array(await img.arrayBuffer()) };
    }
    throw new Error('生图服务返回为空（无 b64_json/url）');
  }
}

/** provider 注册表——后续版本在此追加（如 zhipu / dashscope） */
const providers: ImageGenProvider[] = [new GatewayImageGenProvider()];

export function activeImageGenProvider(): ImageGenProvider {
  return providers[0]!;
}
