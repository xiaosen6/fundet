/**
 * PetWindow 渲染层：帧动画引擎 + 漂浮 + 拖拽 + 交互。
 * 挂载在独立 HTML（pet.html），非主窗口 React 树。
 */
import { PET_STATES, PET_SIZE, FADE_MS, FLOAT_AMPLITUDE, FLOAT_PERIOD, BLINK_MIN, BLINK_MAX } from './pet-config.js';

// ---------- 状态 ----------
let currentState = 'idle';
let currentFrame = 0;
let lastFrameTime = 0;
let blinkTimer: ReturnType<typeof setTimeout> | null = null;
let blinkOverride = false;
let isDragging = false;
let petX = 0;
let petY = 0;
let fadeOpacity = 1;
let fadeStart = 0;
const img = document.getElementById('pet-img') as HTMLImageElement;
const root = document.getElementById('pet-root') as HTMLDivElement;

// ---------- 帧动画 + 漂浮（RAF 主循环） ----------
function tick(now: number): void {
  requestAnimationFrame(tick);
  if (isDragging) return;

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
      ? PET_STATES.blink.frames[Math.min(currentFrame, 2)]
      : state.frames[currentFrame];
    img.src = `../${framePath}`;
  }

  // 正弦漂浮
  const floatY = Math.sin((now / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE;

  // 淡入过渡
  const fadeProgress = Math.min(1, (now - fadeStart) / FADE_MS);
  fadeOpacity = fadeProgress;
  img.style.opacity = String(fadeOpacity);

  // 应用位置
  root.style.transform = `translate(${petX}px, ${petY + floatY}px)`;
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

// ---------- 位置持久化 ----------
const POS_KEY = 'fundet.pet.position';
function savePos(): void {
  localStorage.setItem(POS_KEY, JSON.stringify({ x: petX, y: petY }));
}
function loadPos(): void {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      petX = p.x; petY = p.y;
    } else {
      // 默认右下角
      petX = window.innerWidth - PET_SIZE - 24;
      petY = window.innerHeight - PET_SIZE - 60;
    }
  } catch { petX = 24; petY = 100; }
}

// ---------- IPC：接收状态指令 ----------
window.fundet?.onPetState?.((state: string) => {
  setState(state);
});

// hover 穿透切换
root.addEventListener('mouseenter', () => {
  window.fundet?.petSetHover?.(true);
});
root.addEventListener('mouseleave', () => {
  window.fundet?.petSetHover?.(false);
});

// ---------- 交互 ----------
let dragStartX = 0, dragStartY = 0, dragOffsetX = 0, dragOffsetY = 0;
let clickCount = 0;
let clickTimer: ReturnType<typeof setTimeout> | null = null;

root.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  dragOffsetX = petX;
  dragOffsetY = petY;
  root.setPointerCapture(e.pointerId);
  root.style.cursor = 'grabbing';
});

root.addEventListener('pointermove', (e: PointerEvent) => {
  if (!isDragging) return;
  petX = dragOffsetX + (e.screenX - dragStartX);
  petY = dragOffsetY + (e.screenY - dragStartY);
  // 限制在屏幕内
  petX = Math.max(-PET_SIZE / 2, Math.min(window.innerWidth - PET_SIZE / 2, petX));
  petY = Math.max(0, Math.min(window.innerHeight - PET_SIZE / 2, petY));
});

root.addEventListener('pointerup', () => {
  isDragging = false;
  root.style.cursor = 'grab';
  // 贴边吸附（松手时靠哪边就贴哪边）
  const centerX = petX + PET_SIZE / 2;
  if (centerX < window.innerWidth / 2) {
    petX = 8; // 左贴
  } else {
    petX = window.innerWidth - PET_SIZE - 8; // 右贴
  }
  savePos();
});

root.addEventListener('click', () => {
  clickCount++;
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    if (clickCount >= 2) {
      // 双击 → 新对话
      void window.fundet?.petNewChat?.();
    }
    clickCount = 0;
  }, 250);
});

// 右键菜单（原生 contextMenu 由主进程处理）
root.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// ---------- 启动 ----------
loadPos();
scheduleBlink();
requestAnimationFrame(tick);

// 通知主进程渲染层就绪
void window.fundet?.petReady?.();
