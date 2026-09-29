/**
 * 完成提示音：WebAudio 双音 chime（A5→D6，约 0.5s）——零资产文件、离线可用、
 * 随应用音量；Electron 默认 autoplay 策略允许无手势播放。
 */
export function playCompletionChime(): void {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const note = (freq: number, at: number, dur: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    };
    note(880, 0, 0.25);
    note(1174.66, 0.12, 0.35);
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch {
    /* 无音频设备等：静默 */
  }
}
