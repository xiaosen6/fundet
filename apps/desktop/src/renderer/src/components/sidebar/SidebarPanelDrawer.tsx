/**
 * SidebarPanelDrawer —— 侧栏左上能力入口（IM 机器人 / 技能 / MCP 服务器 / 知识库）
 * 的独立抽屉面板：点击按钮就地滑出管理面板，不再跳转设置页。
 *
 * 复用设置页的四个 Panel 组件（自含状态，挂载即拉数据）；Esc / 遮罩 / × 关闭。
 * portal 到 body，避免被侧栏宽度裁剪。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ImBotPanel } from '../../pages/settings/ImBotPanel';
import { SkillsPanel } from '../../pages/settings/SkillsPanel';
import { McpPanel } from '../../pages/settings/McpPanel';
import { KnowledgePanel } from '../../pages/settings/KnowledgePanel';

export type SidebarPanelId = 'im' | 'skills' | 'mcp' | 'knowledge';

const TITLES: Record<SidebarPanelId, string> = {
  im: 'IM 机器人',
  skills: '技能',
  mcp: 'MCP 服务器',
  knowledge: '知识库',
};

export function SidebarPanelDrawer({
  panel,
  onClose,
}: {
  panel: SidebarPanelId;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[65]">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onMouseDown={onClose}
      />
      <div className="absolute top-0 left-0 flex h-full w-[520px] max-w-[92vw] flex-col border-r border-board bg-surface shadow-[var(--shadow-menu)]">
        <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-board px-4">
          <span className="text-15 font-medium text-primary">{TITLES[panel]}</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-primary"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {panel === 'im' && <ImBotPanel />}
          {panel === 'skills' && <SkillsPanel />}
          {panel === 'mcp' && <McpPanel />}
          {panel === 'knowledge' && <KnowledgePanel />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
