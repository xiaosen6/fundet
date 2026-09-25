/**
 * 语音输入 hook：MediaRecorder 录音 → WAV 转码 → 网关 ASR 转写。
 * 服务端 SenseVoice 无 VAD，单段上限 30s——25s 自动停留余量。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToWavBase64 } from '../lib/wav-encode';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

const MAX_SECONDS = 25;

export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Esc 取消录音（丢弃，不转写）
  useEffect(() => {
    if (state !== 'recording') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelledRef.current = true;
        recorderRef.current?.stop();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [state]);

  const finish = useCallback(async () => {
    const chunks = chunksRef.current;
    cleanup();
    if (cancelledRef.current || chunks.length === 0) {
      setState('idle');
      setSeconds(0);
      return;
    }
    setState('transcribing');
    try {
      const wavBase64 = await blobToWavBase64(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
      const { text } = await window.fundet.voiceTranscribe(wavBase64);
      if (text) onTextRef.current(text);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState('idle');
      setSeconds(0);
    }
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finish();
      recorder.start();
      setState('recording');
      setSeconds(0);
      const t0 = Date.now();
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) {
          recorderRef.current?.stop();
        }
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
  }, [cleanup, finish]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  return { state, seconds, error, start, stop, cancel, toggle };
}
