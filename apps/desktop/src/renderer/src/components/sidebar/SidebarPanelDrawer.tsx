/**
 * SidebarPanelDrawer —— 侧栏左上能力入口（IM 机器人 / 技能 / MCP 服务器 / 知识库）
 * 的整屏面板：点击按钮全屏接管（对齐设置页的整页解剖：返回 + 大标题 + 居中内容列），
 * 不再跳转设置页。复用设置页的四个 Panel 组件（自含状态，挂载即拉数据）；
 * Esc / 返回键退出。portal 到 body。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
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
    <div className="fixed inset-0 z-[45] flex flex-col bg-surface">
      {/* 页头：返回 + 大标题（对齐设置页内栏头部解剖） */}
      <div className="flex h-[46px] shrink-0 items-center gap-2.5 px-4">
        <button
          type="button"
          aria-label="返回"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-24 leading-[1.1] font-medium text-primary">{TITLES[panel]}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32 pt-2">
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
