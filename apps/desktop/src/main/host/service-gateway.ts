/**
 * 统一服务网关（自建 nginx 网关：ASR/嵌入/生图/文本）客户端。
 * ASR 2026-10-08 起 Qwen3-ASR-1.7B（换掉 SenseVoice，中文字级准确率更优）：
 * 需 model 字段 + Bearer 鉴权，支持 hotwords 热词偏置；地址用户可配（设置）。
 */
import { getSetting } from '../db/settings.js';

export const SERVICE_GATEWAY_SETTING = 'service.gatewayUrl';
export const DEFAULT_GATEWAY_URL = 'http://111.34.136.32:16668';
export const ASR_MODEL_SETTING = 'service.asrModel';
const DEFAULT_ASR_MODEL = 'Qwen3-ASR-1.7B';
export const ASR_API_KEY_SETTING = 'service.asrApiKey';
/** 网关级共享 key（挡外网滥用，非 per-user 秘密；与网关地址同等敏感度，可设置覆盖） */
const DEFAULT_ASR_API_KEY = 'fundet-7cb3536c1f891e5ea59d8a599c0e1c03';
/** 热词偏置：用户对话高频技术词（SenseVoice 时代「DeepSeek→deeps」模型上限的
 *  客户端侧补法；Qwen3-ASR hotwords 官方用法，逗号分隔） */
const DEFAULT_ASR_HOTWORDS = 'Fundet,DeepSeek,GLM,Qwen,Claude,GPT,Agent,MCP';

export function gatewayUrl(): string {
  const v = getSetting(SERVICE_GATEWAY_SETTING)?.trim();
  return v || DEFAULT_GATEWAY_URL;
}

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, '')}${p}`;
}

export interface AsrResult {
  text: string;
}

/** 音频（wav 等）→ 中文文本。multipart POST /v1/audio/transcriptions（Qwen3-ASR-1.7B）。 */
export async function transcribeAudio(
  bytes: Buffer,
  fileName: string,
  mimeType = 'audio/wav',
  timeoutMs = 60_000,
): Promise<AsrResult> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  fd.append('model', getSetting(ASR_MODEL_SETTING)?.trim() || DEFAULT_ASR_MODEL);
  fd.append('hotwords', DEFAULT_ASR_HOTWORDS);
  const apiKey = getSetting(ASR_API_KEY_SETTING)?.trim() || DEFAULT_ASR_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(gatewayUrl(), '/v1/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`语音转写失败（HTTP ${res.status}）：${detail}`);
    }
    const j = (await res.json()) as { text?: string };
    return { text: (j.text ?? '').trim() };
  } finally {
    clearTimeout(timer);
  }
}

export interface EmbedResult {
  vectors: number[][];
}

/** 批量文本 → 嵌入向量（Qwen3-Embedding，2560 维）。POST /v1/embeddings。 */
export async function embedTexts(
  inputs: string[],
  opts: { instruct?: string } = {},
  timeoutMs = 120_000,
): Promise<EmbedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model: 'Qwen3-Embedding-4B',
      input: inputs.map((t) => (opts.instruct ? `${opts.instruct}\nQuery: ${t}` : t)),
    };
    const res = await fetch(joinUrl(gatewayUrl(), '/v1/embeddings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`嵌入服务失败（HTTP ${res.status}）：${detail}`);
    }
    const j = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vectors = (j.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== inputs.length) throw new Error('嵌入返回条数与输入不符');
    return { vectors };
  } finally {
    clearTimeout(timer);
  }
}

/** 网关健康探测（ASR 通即可，返回人话状态 + 结构化地址） */
export async function probeGateway(): Promise<{ ok: boolean; detail: string; url: string }> {
  const base = gatewayUrl();
  // 新网关（Qwen3-ASR）探 /health；旧路径 /asr/health 保留回落（自建网关历史路径）
  for (const p of ['/health', '/asr/health']) {
    try {
      const res = await fetch(joinUrl(base, p), { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { ok: true, detail: `ASR 服务正常`, url: base };
    } catch {
      /* try next */
    }
  }
  return { ok: false, detail: `网关不可达`, url: base };
}
