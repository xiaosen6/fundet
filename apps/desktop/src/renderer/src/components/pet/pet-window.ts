/**
 * PetWindow 渲染层：帧动画引擎 + 漂浮 + 交互。
 * 挂载在独立 HTML（pet.html），非主窗口 React 树。
 *
 * 穿透模型：主进程 setIgnoreMouseEvents(true,{forward:true}) 时只有 mousemove 能到达页面，
 * hover 判定用 mousemove + elementFromPoint（mouseenter/leave 在穿透状态下不会触发）。
 * 拖拽 = 通知主进程平移窗口本体；root 在窗口内固定居中，不做渲染层位移。
 */
import { PET_STATES, FADE_MS, FLOAT_AMPLITUDE, FLOAT_PERIOD, BLINK_MIN, BLINK_MAX } from './pet-config.js';

// ---------- 状态 ----------
let currentState = 'idle';
let currentFrame = 0;
let lastFrameTime = 0;
let blinkTimer: ReturnType<typeof setTimeout> | null = null;
let blinkOverride = false;
let fadeStart = 0;
const img = document.getElementById('pet-img') as HTMLImageElement;
const root = document.getElementById('pet-root') as HTMLDivElement;

// ---------- 帧动画 + 漂浮（RAF 主循环） ----------
function tick(now: number): void {
  requestAnimationFrame(tick);

  // 帧切换
  const state = PET_STATES[currentState as keyof typeof PET_STATES];
  if (state && now - lastFrameTime >= state.interval) {
    lastFrameTime = now;
    currentFrame++;
    if (currentFrame >= state.frames.length) {
      if (state.loop) {
        currentFrame = 0;
      } else if (state.fallback) {
        setState(state.fallback);
        return;
      } else {
        currentFrame = state.frames.length - 1;
      }
    }
    const framePath = blinkOverride && currentState === 'idle'
      ? PET_STATES.blink.frames[Math.min(currentFrame, PET_STATES.blink.frames.length - 1)]
      : state.frames[currentFrame];
    img.src = framePath;
  }

  // 正弦漂浮
  const floatY = Math.sin((now / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE;

  // 淡入过渡
  const fadeProgress = Math.min(1, (now - fadeStart) / FADE_MS);
  img.style.opacity = String(fadeProgress);

  // 应用漂浮位移
  root.style.transform = `translateY(${floatY}px)`;
}

// ---------- 状态切换 ----------
function setState(id: string): void {
  if (currentState === id) return;
  currentState = id;
  currentFrame = 0;
  lastFrameTime = 0;
  fadeStart = performance.now();
  // 单次动作播完不再眨眼
  if (id !== 'idle') blinkOverride = false;
}

// ---------- 眨眼随机插播 ----------
function scheduleBlink(): void {
  if (blinkTimer) clearTimeout(blinkTimer);
  const delay = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
  blinkTimer = setTimeout(() => {
    if (currentState === 'idle') {
      blinkOverride = true;
      currentFrame = 0;
      lastFrameTime = 0;
      // 眨眼 3 帧后恢复
      setTimeout(() => { blinkOverride = false; }, 350);
    }
    scheduleBlink();
  }, delay);
}

// ---------- IPC：接收状态指令 ----------
window.fundet?.onPetState?.((state: string) => {
  setState(state);
});

// ---------- hover 穿透切换（穿透下只有 mousemove 可达） ----------
let hoverActive = false;
document.addEventListener('mousemove', (e: MouseEvent) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const over = !!el && (el === root || root.contains(el));
  if (over !== hoverActive) {
    hoverActive = over;
    window.fundet?.petSetHover?.(over);
  }
});

// ---------- 拖拽：通知主进程平移窗口本体 ----------
let dragging = false;
let dragMoved = false;
let downX = 0, downY = 0, lastX = 0, lastY = 0;

root.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return;
  dragging = true;
  dragMoved = false;
  downX = lastX = e.screenX;
  downY = lastY = e.screenY;
  try { root.setPointerCapture(e.pointerId); } catch { /* noop */ }
  root.style.cursor = 'grabbing';
});

root.addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging) return;
  if (!dragMoved) {
    if (Math.hypot(e.screenX - downX, e.screenY - downY) < 6) return;
    dragMoved = true;
  }
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  window.fundet?.petDrag?.(dx, dy);
});

root.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  root.style.cursor = 'grab';
  // 拖动过才贴边归位，纯点击不动
  if (dragMoved) window.fundet?.petDragEnd?.();
});

// ---------- 点击：单击聚焦主窗，双击新对话；拖动后不触发 ----------
let clickCount = 0;
let clickTimer: ReturnType<typeof setTimeout> | null = null;
root.addEventListener('click', () => {
  if (dragMoved) return;
  clickCount++;
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    if (clickCount >= 2) {
      void window.fundet?.petNewChat?.();
    } else if (clickCount === 1) {
      window.fundet?.petFocusMain?.();
    }
    clickCount = 0;
  }, 260);
});

// 右键菜单（原生 contextMenu 由主进程处理）
root.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// ---------- 启动 ----------
scheduleBlink();
requestAnimationFrame(tick);

// 通知主进程渲染层就绪
void window.fundet?.petReady?.();
