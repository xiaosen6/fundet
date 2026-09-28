/**
 * PetWindow 渲染层：密集帧轮播（ping-pong）+ 漂浮 + 交互。
 * 挂载在独立 HTML（pet.html），非主窗口 React 树。
 *
 * 穿透模型：主进程 setIgnoreMouseEvents(true,{forward:true}) 时只有 mousemove 能到达页面，
 * hover 判定用 mousemove + elementFromPoint（mouseenter/leave 在穿透状态下不会触发）。
 * 拖拽 = 主进程轮询光标平移窗口本体；root 在窗口内固定居中，不做渲染层位移。
 * 帧切换走双 img 交叉淡化（等 onload + 绝对 URL 去重，避免半加载闪白）。
 */
import {
  PET_STATES,
  FLOAT_AMPLITUDE,
  FLOAT_PERIOD,
  IDLE_BLINK_EVERY,
  IDLE_HOP_EVERY,
  type PetStateId,
} from './pet-config.js';

// ---------- 状态 ----------
let currentState: keyof typeof PET_STATES = 'idle';
let currentFrame = 0;
let frameDir = 1; // ping-pong 方向
let lastFrameTime = 0;
let stateStart = 0;
let dragging = false; // 按下即 true
let dragMoved = false; // 位移超阈值才算拖动（区分单击）
const imgA = document.getElementById('pet-img') as HTMLImageElement;
const imgB = document.getElementById('pet-img-b') as HTMLImageElement;
const root = document.getElementById('pet-root') as HTMLDivElement;
let frontIsA = true;

/** 帧展示：双 img 交叉淡化；等新帧 onload 再过渡，避免半加载闪白 */
function showFrame(framePath: string, fadeMs: number): void {
  const front = frontIsA ? imgA : imgB;
  const back = frontIsA ? imgB : imgA;
  const abs = new URL(framePath, location.href).href;
  if (front.src === abs) return;
  back.style.transitionDuration = `${fadeMs}ms`;
  front.style.transitionDuration = `${fadeMs}ms`;
  back.onload = () => {
    back.onload = null;
    back.style.opacity = '1';
    front.style.opacity = '0';
    frontIsA = !frontIsA;
  };
  back.src = abs;
}

// ---------- 帧推进：独立 setInterval 驱动 ----------
// （不用 RAF：窗口被 setPosition 高频移动时合成器可能暂停 RAF 回调，动画会停走）
function advanceFrame(): void {
  const st = PET_STATES[dragMoved ? 'running' : currentState];
  if (st.frames.length <= 1) {
    showFrame(st.frames[0], st.fadeMs ?? 40);
    return;
  }
  const now = performance.now();
  if (now - lastFrameTime >= st.interval) {
    lastFrameTime = now;
    currentFrame++;
    if (currentFrame > st.frames.length - 1) {
      if (st.loop) {
        currentFrame = 0;
      } else if (st.fallback) {
        setState(st.fallback);
      } else {
        currentFrame = st.frames.length - 1;
      }
    }
  }
  showFrame(st.frames[currentFrame], st.fadeMs ?? 40);
}

// ---------- RAF 主循环：定长回落 + 漂浮 + 代码动画 ----------
function tick(now: number): void {
  requestAnimationFrame(tick);

  const st = PET_STATES[dragMoved ? 'running' : currentState];

  // 定长状态（眨眼）到时回落
  if (st.duration && now - stateStart >= st.duration) {
    setState(st.fallback ?? 'idle');
    return;
  }

  // 拖动（跑步）时无漂浮，交给跑步帧动画
  const floatY = dragMoved ? 0 : Math.sin((now / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE;

  // 单帧状态的代码动画（极轻——待机以静为主，相位用全局 now 保证连续）
  let sx = 1;
  let sy = 1;
  let rot = 0;
  if (!dragMoved) {
    if (st.anim === 'breath') {
      const p = Math.sin((now / 2400) * Math.PI * 2);
      sy = 1 + 0.01 * p;
      sx = 1 - 0.006 * p;
    } else if (st.anim === 'sway') {
      rot = 1.5 * Math.sin((now / 2600) * Math.PI * 2);
    }
  }
  root.style.transform = `translateY(${floatY}px) rotate(${rot}deg) scale(${sx * facing}, ${sy})`;
}

// ---------- 待机偶发动作：随机眨眼 / 随机跳跃（生命感来源） ----------
function randMs([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}
function scheduleIdleGestures(): void {
  setTimeout(() => {
    if (currentState === 'idle') setState(Math.random() < 0.6 ? 'blink' : 'notify');
    scheduleIdleGestures();
  }, randMs(Math.random() < 0.7 ? IDLE_BLINK_EVERY : IDLE_HOP_EVERY));
}

// ---------- 状态切换 ----------
function setState(id: PetStateId): void {
  if (currentState === id) return;
  currentState = id;
  currentFrame = 0;
  frameDir = 1;
  lastFrameTime = 0;
  stateStart = performance.now();
}

// ---------- IPC：接收状态指令 ----------
window.fundet?.onPetState?.((state: string) => {
  if (state in PET_STATES) setState(state as PetStateId);
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
let downX = 0;
let downY = 0;
let lastX = 0;
let facing = 1; // 1=面朝右，-1=面朝左（水平翻转由 root transform 应用）

root.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return;
  dragging = true;
  dragMoved = false;
  downX = lastX = e.screenX;
  downY = e.screenY;
  try { root.setPointerCapture(e.pointerId); } catch { /* noop */ }
});

root.addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging) return;
  if (!dragMoved) {
    if (Math.hypot(e.screenX - downX, e.screenY - downY) < 6) return;
    dragMoved = true;
    root.style.cursor = 'grabbing';
    currentFrame = 0;
    lastFrameTime = 0;
    window.fundet?.petDragStart?.();
  }
  // 拖动方向 → 跑步朝向
  const dx = e.screenX - lastX;
  if (dx > 2) facing = 1;
  else if (dx < -2) facing = -1;
  lastX = e.screenX;
});

root.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  root.style.cursor = 'grab';
  // dragMoved 保持到下次 pointerdown 再复位（click 抑制依赖它）
  if (dragMoved) {
    facing = 1;
    currentFrame = 0;
    lastFrameTime = 0;
    window.fundet?.petDragEnd?.();
  }
});

// ---------- 点击/右键：左键=打开主窗口并新建对话，右键=截图问答 ----------
root.addEventListener('click', () => {
  if (dragMoved) return; // 拖动结束不当作点击
  window.fundet?.petNewChat?.();
});

// 右键：显式通知主进程（透明穿透小窗上 webContents context-menu 事件不可靠）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.fundet?.petScreenshot?.();
});

// ---------- 启动 ----------
setState('idle');
showFrame(PET_STATES.idle.frames[0], 240);
scheduleIdleGestures();
setInterval(advanceFrame, 55);
requestAnimationFrame(tick);

// 通知主进程渲染层就绪
void window.fundet?.petReady?.();
