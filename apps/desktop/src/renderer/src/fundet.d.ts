// renderer 侧 window.fundet 类型声明（实现在 preload/index.ts）
import type { FundetApi } from '../../shared/fundet-api.js';

declare global {
  interface Window {
    fundet: FundetApi;
  }
}

export {};
