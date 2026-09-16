/**
 * PanelPage —— 侧栏左上能力入口（IM 机器人 / 技能 / MCP 服务器 / 知识库）的
 * 整屏路由页：点击按钮切换路由（ChatPage 卸载，其 drag 层随之消失——portal
 * 覆盖方案在 Windows 上会被 drag 区吃掉点击，实机结论见 WindowControls 注释）。
 * 页面解剖对齐设置页：返回 + 24px 标题 + 居中 920px 内容列；Esc 返回。
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ImBotPanel } from '../../pages/settings/ImBotPanel';
import { SkillsPanel } from '../../pages/settings/SkillsPanel';
import { McpPanel } from '../../pages/settings/McpPanel';
import { KnowledgePanel } from '../../pages/settings/KnowledgePanel';

export type SidebarPanelId = 'im' | 'skills' | 'mcp' | 'knowledge';

const PANELS: Record<SidebarPanelId, { title: string; body: () => React.JSX.Element }> = {
  im: { title: 'IM 机器人', body: ImBotPanel },
  skills: { title: '技能', body: SkillsPanel },
  mcp: { title: 'MCP 服务器', body: McpPanel },
  knowledge: { title: '知识库', body: KnowledgePanel },
};

export const SIDEBAR_PANEL_PATHS: Record<SidebarPanelId, string> = {
  im: '/panel/im',
  skills: '/panel/skills',
  mcp: '/panel/mcp',
  knowledge: '/panel/knowledge',
};

export function PanelPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const panel = id && id in PANELS ? (id as SidebarPanelId) : null;

  const back = (): void => {
    void navigate('/');
  };

  useEffect(() => {
    if (!panel) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  if (!panel) {
    // 未知面板 id：回首页
    void navigate('/', { replace: true });
    return null;
  }
  const { title, body: Body } = PANELS[panel];
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      {/* 页头：返回箭头 + 拖拽区（标题由各面板正文自带，页头不再重复） */}
      <div className="drag-region flex h-[46px] shrink-0 items-center pl-4 select-none">
        <button
          type="button"
          aria-label="返回"
          onClick={back}
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="sr-only">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32">
          <Body />
        </div>
      </div>
    </div>
  );
}
