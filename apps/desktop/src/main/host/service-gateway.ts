/**
 * 统一服务网关（自建 nginx 网关：ASR/TTS/嵌入/生图/文本）客户端。
 * 文档见 2026-09-24 API_DOC：ASR/TTS/嵌入当前免鉴权；地址用户可配（设置）。
 */
import { getSetting } from '../db/settings.js';

export const SERVICE_GATEWAY_SETTING = 'service.gatewayUrl';
export const DEFAULT_GATEWAY_URL = 'http://111.34.136.32:16668';

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

/** 音频（wav 等）→ 中文文本。multipart POST /v1/audio/transcriptions。 */
export async function transcribeAudio(
  bytes: Buffer,
  fileName: string,
  mimeType = 'audio/wav',
  timeoutMs = 60_000,
): Promise<AsrResult> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(gatewayUrl(), '/v1/audio/transcriptions'), {
      method: 'POST',
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

export interface TtsResult {
  wav: Buffer;
}

/** 中文文本 → 24kHz wav。POST /v1/audio/speech。 */
export async function synthesizeSpeech(text: string, timeoutMs = 120_000): Promise<TtsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(gatewayUrl(), '/v1/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cosyvoice2', input: text, speed: 1.0 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`语音合成失败（HTTP ${res.status}）：${detail}`);
    }
    return { wav: Buffer.from(await res.arrayBuffer()) };
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

/** 网关健康探测（ASR/TTS 任一通即可，返回人话状态 + 结构化地址） */
export async function probeGateway(): Promise<{ ok: boolean; detail: string; url: string }> {
  const base = gatewayUrl();
  for (const [path, label] of [
    ['/asr/health', 'ASR'],
    ['/tts/health', 'TTS'],
  ] as const) {
    try {
      const res = await fetch(joinUrl(base, path), { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { ok: true, detail: `${label} 服务正常`, url: base };
    } catch {
      /* 试下一个 */
    }
  }
  return { ok: false, detail: `网关不可达`, url: base };
}
