/**
 * 录音 blob → 16kHz 单声道 PCM16 WAV（网关 ASR 只收 wav/mp3 等常见格式，
 * MediaRecorder 出的 webm/opus 需前端转码）。
 * 纯浏览器 API，无 Node 依赖。
 */

export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
  // 降采样 + 单声道：OfflineAudioContext 一次渲染到位
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  // 无声检测：Windows 麦克风隐私被关（「允许桌面应用访问麦克风」）时
  // getUserMedia 不报错、只交全零数据，直送 ASR 会转出随机字符（实测 "그."，
  // 2026-09-30 探针 RMS=0/peak=0 实锤）——提前拦下给可行动的中文提示
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak < 0.005) {
    throw new Error(
      '麦克风没有采集到声音：请检查 Windows 设置 → 隐私和安全性 → 麦克风（确认「允许桌面应用访问麦克风」已开启），以及 系统设置 → 声音 → 输入 的设备与音量',
    );
  }

  const bytes = encodeWavPcm16(samples, targetRate);
  return arrayBufferToBase64(bytes);
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
