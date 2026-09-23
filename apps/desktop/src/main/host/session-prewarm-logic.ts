/**
 * 草稿预热的纯逻辑（零 Electron/DB 依赖，node --test 直跑）。
 * 语义见 session-prewarm.ts 头注。
 */
import { BROWSER_ENABLED_SETTING } from '../../shared/browser-settings.ts';
import { COMPUTER_ENABLED_SETTING } from '../../shared/computer-settings.ts';

export interface PrewarmFingerprintInput {
  sessionId: string;
  providerId: string;
  workDir: string;
  getBinding?: (sessionId: string) => { ids: string[]; dingtalk?: boolean };
  boolSetting?: (key: string, def: boolean) => boolean;
}

/** 指纹 = 结构性配置（换任何一个都得重建会话）：provider/工作目录/MCP 工具集 */
export function computePrewarmFingerprint(input: PrewarmFingerprintInput): string {
  const getBinding: NonNullable<PrewarmFingerprintInput['getBinding']> =
    input.getBinding ?? (() => ({ ids: [] }));
  const boolSetting = input.boolSetting ?? (() => false);
  const kb = getBinding(input.sessionId);
  return JSON.stringify({
    providerId: input.providerId,
    workDir: input.workDir,
    kbIds: [...kb.ids].sort(),
    kbDingtalk: kb.dingtalk === true,
    browser: boolSetting(BROWSER_ENABLED_SETTING, false),
    computer: boolSetting(COMPUTER_ENABLED_SETTING, false),
  });
}

/** attach 决策：none=非预热会话（原语义）；attach=现成可用；discard=清障重建 */
export function decidePrewarmAttach(args: {
  hasRecord: boolean;
  alive: boolean;
  fingerprintMatch: boolean;
  expiredAndEmpty: boolean;
}): 'none' | 'attach' | 'discard' {
  if (!args.hasRecord) return 'none';
  if (!args.alive || !args.fingerprintMatch || args.expiredAndEmpty) return 'discard';
  return 'attach';
}

/** 预热会话无消息的存活上限；60s 巡检到点回收 */
export const PREWARM_TTL_MS = 5 * 60_000;
export const PREWARM_PLACEHOLDER_TITLES = ['', '新会话', '新对话'];
