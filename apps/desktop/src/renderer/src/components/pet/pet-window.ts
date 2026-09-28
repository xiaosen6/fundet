/**
 * PetWindow 渲染层：帧动画引擎 + 漂浮 + 交互。
 * 挂载在独立 HTML（pet.html），非主窗口 React 树。
 *
 * 穿透模型：主进程 setIgnoreMouseEvents(true,{forward:true}) 时只有 mousemove 能到达页面，
 * hover 判定用 mousemove + elementFromPoint（mouseenter/leave 在穿透状态下不会触发）。
 * 拖拽 = 通知主进程平移窗口本体；root 在窗口内固定居中，不做渲染层位移。
 */
import { PET_STATES, FLOAT_AMPLITUDE, FLOAT_PERIOD, BLINK_MIN, BLINK_MAX } from './pet-config.js';

// ---------- 状态 ----------
let currentState = 'idle';
let currentFrame = 0;
let lastFrameTime = 0;
let blinkTimer: ReturnType<typeof setTimeout> | null = null;
let blinkOverride = false;
let dragging = false; // 按下即 true
let dragMoved = false; // 位移超阈值才算拖动（区分单击）
const imgA = document.getElementById('pet-img') as HTMLImageElement;
const imgB = document.getElementById('pet-img-b') as HTMLImageElement;
const root = document.getElementById('pet-root') as HTMLDivElement;
let frontIsA = true;

/** 帧展示：双 img 交叉淡化（80ms），跳变动画变柔和 */
function showFrame(framePath: string): void {
  const front = frontIsA ? imgA : imgB;
  const back = frontIsA ? imgB : imgA;
  if (front.getAttribute('src') === framePath) return;
  back.src = framePath;
  frontIsA = !frontIsA;
  requestAnimationFrame(() => {
    back.style.opacity = '1';
    front.style.opacity = '0';
  });
}

// ---------- 帧动画 + 漂浮（RAF 主循环） ----------
let floatAmp = 1; // 漂浮幅度（拖动时平滑归零，避免"拖不住、发飘"）
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
    showFrame(framePath);
  }

  // 正弦漂浮（拖动时平滑衰减到 0，松手恢复）
  floatAmp += ((dragMoved ? 0 : 1) - floatAmp) * 0.15;
  const floatY = Math.sin((now / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE * floatAmp;
  root.style.transform = `translateY(${floatY}px)`;
}

// ---------- 状态切换 ----------
function setState(id: string): void {
  if (currentState === id) return;
  currentState = id;
  currentFrame = 0;
  lastFrameTime = 0;
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
  if (dragging) return; // 拖动中穿透已解除，跳过 hit-test
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const over = !!el && (el === root || root.contains(el));
  if (over !== hoverActive) {
    hoverActive = over;
    window.fundet?.petSetHover?.(over);
  }
});

// ---------- 拖拽：确立拖动后交主进程轮询光标平移窗口 ----------
let downX = 0, downY = 0;

root.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return;
  dragging = true;
  dragMoved = false;
  downX = e.screenX;
  downY = e.screenY;
  try { root.setPointerCapture(e.pointerId); } catch { /* noop */ }
});

root.addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging || dragMoved) return;
  if (Math.hypot(e.screenX - downX, e.screenY - downY) < 6) return;
  dragMoved = true;
  root.style.cursor = 'grabbing';
  window.fundet?.petDragStart?.();
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

// 右键菜单：显式通知主进程（透明穿透小窗上 webContents context-menu 事件不可靠）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.fundet?.petContextMenu?.();
});

// ---------- 启动 ----------
scheduleBlink();
requestAnimationFrame(tick);

// 通知主进程渲染层就绪
void window.fundet?.petReady?.();
