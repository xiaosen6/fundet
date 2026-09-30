/**
 * 生图能力共享常量（渲染/主进程共用，纯数据）。
 *
 * v1：内置走自建网关的 Qwen-Image-2.1（与语音/嵌入同一网关，地址见
 * service-gateway 的 service.gatewayUrl 设置）。架构上留 provider 口——
 * 后续版本接其他生图服务（智谱 CogView / 通义万相等）时在 main/imagegen/
 * gateway.ts 注册新 provider 即可，不动工具面。
 */

export const IMAGEGEN_ENABLED_SETTING = 'imagegen.enabled';

export const IMAGEGEN_MCP_SERVER_NAME = 'fundet-imagegen';

export const IMAGEGEN_TOOL_NAME = 'generate_image';

/** 生图请求（provider 无关的形状；各 provider 自行翻译成自家 API） */
export interface ImageGenRequest {
  prompt: string;
  /** "宽x高"，如 1024x1024 */
  size: string;
}

export interface ImageGenResult {
  /** 图片字节（PNG/JPEG 由内容决定，调用方按魔数嗅探扩展名） */
  bytes: Uint8Array;
}
