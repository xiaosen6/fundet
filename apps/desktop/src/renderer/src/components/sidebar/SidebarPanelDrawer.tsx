/**
 * PanelView —— 侧栏左上能力入口（IM 机器人 / 技能 / MCP 服务器 / 知识库）的
 * 主区内嵌面板：ChatPage 右侧（原会话区域）就地切换显示，侧栏保持可见
 * （用户 2026-09-16 拍板：不做整页路由，右侧直接显示，相当于会话的部分）。
 * 页头：返回箭头 + 拖拽区（标题由各面板正文自带）；Esc 返回会话。
 */
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ImBotPanel } from '../../pages/settings/ImBotPanel';
import { SkillsPanel } from '../../pages/settings/SkillsPanel';
import { McpPanel } from '../../pages/settings/McpPanel';
import { KnowledgePanel } from '../../pages/settings/KnowledgePanel';

export type SidebarPanelId = 'im' | 'skills' | 'mcp' | 'knowledge';

const PANELS: Record<SidebarPanelId, () => React.JSX.Element> = {
  im: ImBotPanel,
  skills: SkillsPanel,
  mcp: McpPanel,
  knowledge: KnowledgePanel,
};

export function PanelView({
  id,
  onBack,
}: {
  id: SidebarPanelId;
  onBack: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const Body = PANELS[id];
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 页头：返回 + 拖拽区（正文自带 SectionTitle，页头不重复） */}
      <div className="drag-region flex h-[46px] shrink-0 items-center px-4 select-none">
        <button
          type="button"
          aria-label="返回会话"
          onClick={onBack}
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary"
        >
          <ArrowLeft size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32">
          <Body />
        </div>
      </div>
    </div>
  );
}
