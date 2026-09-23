import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { brand } from '../../shared/brand.js';
import './styles/globals.css';
import { applyFonts } from './lib/fonts';
import { initGlobalListeners } from './stores/sessionStore';

// localStorage 键名品牌迁移（longma.* → fundet.*，一次性；在 fonts 等读取方初始化前跑）
for (const [oldKey, newKey] of [
  ['longma.font.ui', 'fundet.font.ui'],
  ['longma.font.code', 'fundet.font.code'],
  ['longma.profile', 'fundet.profile'],
  ['longma.sidebar-width', 'fundet.sidebar-width'],
] as const) {
  const oldValue = localStorage.getItem(oldKey);
  if (oldValue !== null) {
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, oldValue);
    localStorage.removeItem(oldKey);
  }
}

applyFonts();
import { ChatPage } from './pages/ChatPage';import { SettingsPage } from './pages/SettingsPage';
import { DebugPage } from './pages/DebugPage';
import { WindowControls } from './components/WindowControls';
import { ToastContainer } from './components/ui/toast';
import { ConfirmDialogHost } from './components/ui/ConfirmDialog';
import { LightboxHost } from './components/ui/Lightbox';
import { FadeSwitcher } from './components/ui/FadeSwitcher';
import { Splash } from './components/Splash';

// 全局 agent:event 监听只装一次（模块级 store，与 React 树解耦，
// 切页面/切会话不影响后台 turn 的事件分发）
initGlobalListeners();

/** 路由切换淡入（Cindy F4）：pathname 变化 → 220ms 浮现 */
function RouteFade(): React.JSX.Element {
  const location = useLocation();
  return (
    <FadeSwitcher trigger={location.pathname} className="h-full">
      <Outlet />
    </FadeSwitcher>
  );
}

const router = createHashRouter([
  {
    element: <RouteFade />,
    children: [
      { path: '/', element: <ChatPage /> },
      { path: '/settings', element: <SettingsPage /> },
      // 调试台保留：E2E 复验与原始事件流排查用
      { path: '/debug', element: <DebugPage /> },
    ],
  },
]);

document.title = brand.name;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="relative h-full">
      <div className="no-drag absolute top-0 right-0 z-50">
        <WindowControls />
      </div>
      <RouterProvider router={router} />
      <Splash />
      <ToastContainer />
      <ConfirmDialogHost />
      <LightboxHost />
    </div>
  </React.StrictMode>,
);
