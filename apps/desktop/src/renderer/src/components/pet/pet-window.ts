/**
 * PetWindow 渲染层：单帧 + 代码动画（呼吸/摇摆/弹跳）+ 漂浮 + 交互。
 * 挂载在独立 HTML（pet.html），非主窗口 React 树。
 *
 * 穿透模型：主进程 setIgnoreMouseEvents(true,{forward:true}) 时只有 mousemove 能到达页面，
 * hover 判定用 mousemove + elementFromPoint（mouseenter/leave 在穿透状态下不会触发）。
 * 拖拽 = 主进程轮询光标平移窗口本体；root 在窗口内固定居中，不做渲染层位移。
 * 动画全部 RAF 数学连续驱动（素材帧间不连贯，不用多帧轮播避免抖动）。
 */
import { PET_STATES, FLOAT_AMPLITUDE, FLOAT_PERIOD, type PetStateId } from './pet-config.js';

// ---------- 状态 ----------
let currentState: keyof typeof PET_STATES = 'idle';
let stateStart = 0;
let dragging = false; // 按下即 true
let dragMoved = false; // 位移超阈值才算拖动（区分单击）
const imgA = document.getElementById('pet-img') as HTMLImageElement;
const imgB = document.getElementById('pet-img-b') as HTMLImageElement;
const root = document.getElementById('pet-root') as HTMLDivElement;
let frontIsA = true;

/** 帧展示：双 img 交叉淡化（80ms）；等新帧 onload 再过渡，避免半加载闪白 */
function showFrame(framePath: string): void {
  const front = frontIsA ? imgA : imgB;
  const back = frontIsA ? imgB : imgA;
  const abs = new URL(framePath, location.href).href;
  if (front.src === abs) return;
  back.onload = () => {
    back.onload = null;
    back.style.opacity = '1';
    front.style.opacity = '0';
    frontIsA = !frontIsA;
  };
  back.src = abs;
}

// ---------- RAF 主循环：漂浮 + 状态内代码动画 ----------
let floatAmp = 1; // 漂浮幅度（拖动时平滑归零，避免"拖不住、发飘"）
function tick(now: number): void {
  requestAnimationFrame(tick);

  const st = PET_STATES[currentState];

  // 一次性状态（眨眼/通知）到时回落
  if (st.duration && now - stateStart >= st.duration) {
    setState(st.fallback ?? 'idle');
    return;
  }

  showFrame(st.frame);

  // 正弦漂浮（拖动时平滑衰减到 0，松手恢复）
  floatAmp += ((dragMoved ? 0 : 1) - floatAmp) * 0.15;
  const floatY = Math.sin((now / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE * floatAmp;

  // 状态内动画（transform-origin 在脚底，缩放/摆动不离地）
  const t = now - stateStart;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  if (st.anim === 'breath') {
    const p = Math.sin((t / 1600) * Math.PI * 2);
    sy = 1 + 0.02 * p;
    sx = 1 - 0.012 * p;
  } else if (st.anim === 'sway') {
    rot = 2.5 * Math.sin((t / 2200) * Math.PI * 2);
  } else if (st.anim === 'bounce') {
    const p = Math.abs(Math.sin((t / 450) * Math.PI));
    sy = 1 + 0.06 * p;
    sx = 1 - 0.04 * p;
  }
  root.style.transform = `translateY(${floatY}px) rotate(${rot}deg) scale(${sx}, ${sy})`;
}

// ---------- 状态切换 ----------
function setState(id: PetStateId): void {
  if (currentState === id) return;
  currentState = id;
  stateStart = performance.now();
}

// ---------- IPC：接收状态指令 ----------
window.fundet?.onPetState?.((state: string) => {
  if (state in PET_STATES) setState(state as PetStateId);
});

// 首帧渲染（onPetState 异步，先本地起 idle）
setState('idle');

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
  if (dragMoved) window.fundet?.petDragEnd?.();
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
requestAnimationFrame(tick);

// 通知主进程渲染层就绪
void window.fundet?.petReady?.();
