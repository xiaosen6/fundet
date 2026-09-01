import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { brand } from '../../shared/brand.js';
import './styles/globals.css';
import { applyFonts } from './lib/fonts';
import { initGlobalListeners } from './stores/sessionStore';

applyFonts();
import { ChatPage } from './pages/ChatPage';
import { SettingsPage } from './pages/SettingsPage';
import { DebugPage } from './pages/DebugPage';
import { WindowControls } from './components/WindowControls';

// 全局 agent:event 监听只装一次（模块级 store，与 React 树解耦，
// 切页面/切会话不影响后台 turn 的事件分发）
initGlobalListeners();

const router = createHashRouter([
  { path: '/', element: <ChatPage /> },
  { path: '/settings', element: <SettingsPage /> },
  // 调试台保留：E2E 复验与原始事件流排查用
  { path: '/debug', element: <DebugPage /> },
]);

document.title = brand.name;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="relative h-full">
      <div className="no-drag absolute top-0 right-0 z-50">
        <WindowControls />
      </div>
      <RouterProvider router={router} />
    </div>
  </React.StrictMode>,
);
