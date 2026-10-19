/**
 * IME Enter 守卫 React 适配（纯逻辑在 lib/imeEnterGuard）。三个 Enter 提交点共用：
 * ChatInput 主输入 / MessageStream 原位编辑 / AskUserQuestion 自由输入。
 */
import { useCallback, useMemo, useRef } from 'react';
import {
  decideEnterGuard,
  IME_POST_COMPOSITION_GUARD_MS,
  isGuardedNewlineInsert,
  isWebKitEngine,
} from '../lib/imeEnterGuard';

export type EnterGuardResult = 'pass' | 'yield' | 'block';

export function useImeEnterGuard(): {
  onCompositionEnd: (e: React.CompositionEvent) => void;
  onCompositionStart: () => void;
  /** keydown 时调用；'block' = 拦下不发送（调用方仍需 preventDefault），并自开
   *  beforeinput 换行吞噬窗口 */
  checkKeyDown: (e: React.KeyboardEvent) => EnterGuardResult;
  /** textarea 的 onBeforeInput：吞噬窗口内拦 insertParagraph/insertLineBreak */
  onBeforeInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
} {
  const endedAtRef = useRef<number | null>(null);
  const swallowRef = useRef(false);
  const webkit = useMemo(() => isWebKitEngine(navigator.vendor), []);

  const onCompositionStart = useCallback((): void => {
    endedAtRef.current = null;
    swallowRef.current = false;
  }, []);

  const onCompositionEnd = useCallback((e: React.CompositionEvent): void => {
    endedAtRef.current = e.timeStamp || Date.now();
  }, []);

  const checkKeyDown = useCallback(
    (e: React.KeyboardEvent): EnterGuardResult => {
      const decision = decideEnterGuard({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
        compositionEndedAt: endedAtRef.current,
        now: e.timeStamp || Date.now(),
        webkit,
      });
      if (decision.action === 'block-and-swallow-newline') {
        swallowRef.current = true;
        // 兜底关窗（key 事件序列异常时 500ms 后自动失效）
        setTimeout(() => {
          swallowRef.current = false;
        }, IME_POST_COMPOSITION_GUARD_MS);
        return 'block';
      }
      return decision.action === 'yield-to-ime' ? 'yield' : 'pass';
    },
    [webkit],
  );

  const onBeforeInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>): void => {
      const inputType = (e.nativeEvent as InputEvent).inputType ?? '';
      if (swallowRef.current && isGuardedNewlineInsert(inputType)) {
        e.preventDefault();
        swallowRef.current = false;
      }
    },
    [],
  );

  return { onCompositionEnd, onCompositionStart, checkKeyDown, onBeforeInput };
}
