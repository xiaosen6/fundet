/**
 * WelcomeSuggestions — 新会话空消息态的引导建议卡（对齐 Cindy homeSuggestions）。
 * 池子贴 Fundet 产品能力（技能集市/知识库/钉钉/回滚/模型设置），点击直接把
 * prompt 预填进输入框（用户过目后手动发送）；换一批洗牌取 4，不再显示持久化
 * 到 localStorage。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Briefcase,
  FolderOpen,
  Landmark,
  Search,
  Sparkles,
  Wallet,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';

const STORAGE_DISMISSED = 'fundet.welcome-suggestions.dismissed';

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  Icon: LucideIcon;
}

const POOL: Suggestion[] = [
  {
    id: 'skillhub',
    label: '去技能集市挑一个新技能',
    prompt: '去技能集市的「发现」页看看热门技能，挑一个适合我的装上。',
    Icon: Sparkles,
  },
  {
    id: 'kb',
    label: '把我的文档收进知识库',
    prompt: '帮我建一个知识库并整理一批文档进去，之后聊天可以检索引用。',
    Icon: BookOpen,
  },
  {
    id: 'dingtalk',
    label: '帮我看看今天的钉钉日程',
    prompt: '查一下我今天的钉钉日程，重点提醒我下一场会议。',
    Icon: Briefcase,
  },
  {
    id: 'dingtalk-approval',
    label: '盘点我的待办与待审批',
    prompt: '汇总我的钉钉待办和待审批，按优先级排一下给我。',
    Icon: Wallet,
  },
  {
    id: 'project',
    label: '带我了解这个项目',
    prompt: '带我了解当前工作目录这个项目：它是做什么的、怎么运行，值得深入看的地方。',
    Icon: FolderOpen,
  },
  {
    id: 'env',
    label: '检查一遍我的工作环境',
    prompt: '帮我检查一遍开发环境（Node/Git/常用工具链），找出值得修复或改善的地方，先给建议。',
    Icon: Wrench,
  },
  {
    id: 'search',
    label: '教我配置一个好用的搜索',
    prompt: '帮我配置网络搜索：推荐一个适合我的引擎并指导我完成接入。',
    Icon: Search,
  },
  {
    id: 'rewind',
    label: '演示一下会话文件回滚',
    prompt: '帮我了解会话检查点与文件回滚怎么用：什么场景该回滚、怎么操作。',
    Icon: ArrowLeftRight,
  },
  {
    id: 'localgov',
    label: '搜一下最近的政策申报窗口',
    prompt: '帮我搜一下近期面向企业（尤其山东/济南）的政策申报与补贴窗口，列清单并附截止时间。',
    Icon: Landmark,
  },
  {
    id: 'skills-local',
    label: '盘点我本机装的所有技能',
    prompt: '盘点我本机已装的所有技能，逐个说明是干什么的、哪些值得留着。',
    Icon: Zap,
  },
];

function pick4(exclude: string[]): Suggestion[] {
  const cands = POOL.filter((s) => !exclude.includes(s.id));
  const shuffled = [...cands].sort(() => Math.random() - 0.5);
  // 池不够时允许重复池随机补齐
  while (shuffled.length < 4) shuffled.push(POOL[Math.floor(Math.random() * POOL.length)]!);
  return shuffled.slice(0, 4);
}

export function WelcomeSuggestions({ onPick }: { onPick: (prompt: string) => void }): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(() => window.localStorage.getItem(STORAGE_DISMISSED) === '1');
  const [items, setItems] = useState<Suggestion[]>(() => pick4([]));

  useEffect(() => {
    if (dismissed) window.localStorage.setItem(STORAGE_DISMISSED, '1');
  }, [dismissed]);

  const shuffle = useCallback((): void => {
    setItems((cur) => pick4(cur.map((s) => s.id)));
  }, []);

  const grid = useMemo(() => items, [items]);
  if (dismissed) return null;

  return (
    <div className="flex w-full flex-col items-start gap-2 select-none">
      <div className="flex w-full flex-col gap-2">
        {grid.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="flex h-8 w-fit items-center gap-2 text-13 text-secondary transition-colors hover:text-primary"
          >
            <s.Icon size={13} className="shrink-0 text-muted" />
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex items-center gap-4 text-11 text-muted">
        <button type="button" onClick={shuffle} className="transition-colors hover:text-primary">
          ↻ 换一批
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={cn('flex items-center gap-0.5 transition-colors hover:text-primary')}
        >
          <X size={10} /> 不再显示
        </button>
      </div>
    </div>
  );
}
