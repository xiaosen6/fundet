/**
 * 语音输入 hook v2：直接采集 PCM → WAV → 网关 ASR 转写。
 *
 * 2026-10-02 重写：MediaRecorder（webm/opus）管线在 Electron 里转写质量
 * 差（同段话浏览器正确 vs 应用出错，多次调约束/码率未根治）——改为
 * ScriptProcessorNode 直采 Float32 PCM，跳过 Opus 编码/解码整个有损循环，
 * 从麦克风原始数据直接出 16kHz WAV。
 *
 * 服务端 SenseVoice 无 VAD，单段上限 30s——25s 自动停留余量。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

const MAX_SECONDS = 25;
const INPUT_RATE = 48000;
const TARGET_RATE = 16000;

export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const stoppingRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Esc 取消录音（丢弃，不转写）
  useEffect(() => {
    if (state !== 'recording') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelledRef.current = true;
        stopCapture();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const stopCapture = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const pcmChunks = pcmRef.current;
    cleanup();
    void finish(pcmChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  const finish = useCallback(async (pcmChunks: Float32Array[]) => {
    if (cancelledRef.current || pcmChunks.length === 0) {
      setState('idle');
      setSeconds(0);
      cancelledRef.current = false;
      stoppingRef.current = false;
      return;
    }
    setState('transcribing');
    try {
      // 拼接所有 PCM 块
      const totalLen = pcmChunks.reduce((n, c) => n + c.length, 0);
      const pcm = new Float32Array(totalLen);
      let offset = 0;
      for (const chunk of pcmChunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }

      // 无声/低音量检测：峰值过低提示用户调音量（用户实报 root cause：
      // 系统麦克风输入音量太小导致 ASR 把中文听成英文，2026-10-02）
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) {
        const v = Math.abs(pcm[i]);
        if (v > peak) peak = v;
      }
      if (peak < 0.005) {
        throw new Error(
          '麦克风没有采集到声音：请检查 Windows 设置 → 隐私和安全性 → 麦克风（确认「允许桌面应用访问麦克风」已开启）',
        );
      }
      if (peak < 0.03) {
        // 不阻断，但提示——低音量会让 ASR 质量骤降
        console.warn(`[fundet:voice] 麦克风音量偏低（峰值 ${(peak * 100).toFixed(1)}%），建议调高系统麦克风输入音量`);
      }

      // 降采样 48k → 16k（线性插值，与 OfflineAudioContext 同效果但更透明）
      const ratio = INPUT_RATE / TARGET_RATE;
      const outLen = Math.floor(pcm.length / ratio);
      const resampled = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(pcm.length - 1, i0 + 1);
        resampled[i] = pcm[i0] + (pcm[i1] - pcm[i0]) * (pos - i0);
      }

      // PCM16 WAV 编码
      const wav = encodeWav(resampled, TARGET_RATE);
      const b64 = uint8ToBase64(wav);
      const { text } = await window.fundet.voiceTranscribe(b64);
      if (text) onTextRef.current(text);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState('idle');
      setSeconds(0);
      cancelledRef.current = false;
      stoppingRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      // 关闭 Chromium 默认音频处理 + 锁单声道
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: INPUT_RATE,
        },
      });
      streamRef.current = stream;

      // AudioContext 直采 PCM（不走 MediaRecorder/Opus）
      const ctx = new AudioContext({ sampleRate: INPUT_RATE });
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      // ScriptProcessorNode 每回调收 4096 样本（~85ms @ 48kHz）
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      pcmRef.current = [];
      cancelledRef.current = false;
      stoppingRef.current = false;

      processor.onaudioprocess = (e) => {
        if (cancelledRef.current) return;
        const ch = e.inputBuffer.getChannelData(0);
        pcmRef.current.push(new Float32Array(ch)); // 拷贝（buffer 会被复用）
      };

      source.connect(processor);
      // ScriptProcessor 需连到 destination 才会触发回调（但会回放声音——
      // 用零增益器阻断回放）
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);

      setState('recording');
      setSeconds(0);
      const t0 = Date.now();
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stopCapture();
      }, 250);
    } catch (err) {
      cleanup();
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? '麦克风权限被拒绝，请在系统设置中允许本应用使用麦克风'
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setState('idle');
    }
  }, [cleanup, stopCapture]);

  const stop = useCallback(() => {
    stopCapture();
  }, [stopCapture]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopCapture();
  }, [stopCapture]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  return { state, seconds, error, start, stop, cancel, toggle };
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  w(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); w(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
