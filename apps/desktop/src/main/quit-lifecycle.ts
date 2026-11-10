/** 退出清理协调：重复 before-quit 复用同一清理；有界超时后允许最终退出。 */
export type QuitStartState = 'started' | 'pending' | 'approved';

export function createQuitLifecycle(
  cleanup: () => Promise<void>,
  timeoutMs = 8_000,
): {
  begin: () => QuitStartState;
  pending: () => Promise<void> | null;
  approved: () => boolean;
} {
  let pending: Promise<void> | null = null;
  let approved = false;
  return {
    begin(): QuitStartState {
      if (approved) return 'approved';
      if (pending) return 'pending';
      pending = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([cleanup()]),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          approved = true;
        }
      })();
      return 'started';
    },
    pending: () => pending,
    approved: () => approved,
  };
}
