/**
 * PanelView —— 侧栏左上能力入口（IM 机器人 / 钉钉工作台 / 技能 / 知识库）的
 * 主区内嵌面板：ChatPage 右侧（原会话区域）就地切换显示，侧栏保持可见
 * （用户 2026-09-16 拍板：不做整页路由，右侧直接显示，相当于会话的部分）。
 * 顶部只留 46px 拖拽条（无返回钮——返回走 Esc / 再点同款按钮 / 点会话）；
 * 标题由各面板正文自带。MCP 服务器 0.2.29 起移回设置页（用户拍板），不在侧栏。
 */
import { useEffect } from 'react';
import { ImBotPanel } from '../../pages/settings/ImBotPanel';
import { SkillsPanel } from '../../pages/settings/SkillsPanel';
import { KnowledgePanel } from '../../pages/settings/KnowledgePanel';
import { DwsPanel } from '../../pages/settings/DwsPanel';

export type SidebarPanelId = 'im' | 'skills' | 'knowledge' | 'dws';

const PANELS: Record<SidebarPanelId, () => React.JSX.Element> = {
  im: ImBotPanel,
  skills: SkillsPanel,
  knowledge: KnowledgePanel,
  dws: DwsPanel,
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
      // 有 dialog（技能详情/确认框等）打开时 Esc 归它，不当场连面板一起关
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const Body = PANELS[id];
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 顶部拖拽条：与聊天视图的 46px 页头等高，保持窗口拖动区与切换时布局稳定 */}
      <div className="drag-region h-[46px] shrink-0 select-none" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32">
          <Body />
        </div>
      </div>
    </div>
  );
}
