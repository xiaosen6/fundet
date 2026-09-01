/**
 * SettingsPage —— 设置页（外观复刻 Cindy components/settings/SettingsView.tsx）。
 *
 * 布局：整页 Surface 平铺；左侧内栏（返回箭头 + 24px 标题 + pill tab 列表，
 * 选中 = chip 底反相胶囊），右侧内容列（max-w-[920px] 居中，切分区 150ms 淡入）。
 * 分区范式：标题在卡外（text-16 font-medium）+ 描述（text-13 secondary）+
 * ivory 卡（rounded-xl / 1px Board / p-5）。
 *
 * 功能：主题 / 默认工作目录 / provider CRUD（BYOK）/ 搜索 / IM 机器人 / 技能导入。
 */
import { useState } from 'react';
import { ArrowLeft, Monitor, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserProfileCard } from '../components/settings/UserProfileCard';
import { FontFamilyPicker } from '../components/settings/FontFamilyPicker';
import { ProvidersPanel } from '../components/settings/ProvidersPanel';
import { cn } from '../lib/cn';
import { getDefaultWorkDir, setDefaultWorkDir } from '../lib/defaults';
import {
  CODE_FONT_PRESETS,
  getCodeFont,
  getUiFont,
  setCodeFont,
  setUiFont,
  UI_FONT_PRESETS,
} from '../lib/fonts';
import { useTheme, type ThemeMode } from '../themes/useTheme';
import { SkillsPanel } from './settings/SkillsPanel';
import { SearchPanel } from './settings/SearchPanel';
import { ImBotPanel } from './settings/ImBotPanel';
import { UpdateCard } from '../components/settings/UpdateCard';
import { BrowserSection } from '../components/settings/BrowserSection';
import { UsageHistoryPanel } from './settings/UsageHistoryPanel';
import { ComputerSection } from '../components/settings/ComputerSection';
import { brand } from '../../../shared/brand.ts';

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  previewBg: string;
}> = [
  { value: 'light', label: '米色', previewBg: '#F2EBE1' },
  { value: 'dark', label: '深色', previewBg: '#2A2828' },
  { value: 'system', label: '跟随系统', previewBg: '' },
];

type SettingsTab = 'general' | 'providers' | 'automation' | 'usage' | 'search' | 'im' | 'skills';

const TAB_LABELS: Record<SettingsTab, string> = {
  general: '通用',
  providers: '模型供应商',
  automation: '自动操作',
  usage: '用量历史',
  search: '搜索',
  im: 'IM 机器人',
  skills: '技能',
};

/** 表单字段样式（对齐 Cindy 设置字段：h-10 + 12px 圆角 + Card 底 + 1px Board；
    textarea 等多行场景追加 rounded-inner 覆盖） */
const FIELD_CLS = cn(
  'w-full h-10 rounded-xl border border-board bg-card px-3 text-13 text-primary',
  'placeholder:text-placeholder focus:outline-none focus-visible:border-[var(--input-focus-border)]',
);

/** 分区标题（卡外） */
function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

/** ivory 分区卡 */
function SectionCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export function SettingsPage(): React.JSX.Element {
  const { mode, setMode } = useTheme();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [workDir, setWorkDir] = useState(getDefaultWorkDir());
  const [uiFont, setUiFontState] = useState(getUiFont);
  const [codeFont, setCodeFontState] = useState(getCodeFont);
  return (
    <div className="h-full w-full overflow-hidden bg-surface">
      <div className="flex h-full min-h-0 w-full justify-start pt-7 pb-5">
        {/* 内栏：返回 + 标题 + pill tab 列表（对齐 Cindy SettingsView） */}
        <aside className="flex h-full min-h-0 w-[220px] shrink-0 flex-col gap-2 overflow-y-auto pr-4 pl-6">
          <div className="drag-region flex items-center gap-2.5 px-3 pb-[18px] select-none">
            <Link
              to="/"
              aria-label="返回"
              className="no-drag flex items-center justify-center text-muted transition-colors hover:text-primary"
            >
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-24 leading-[1.1] font-medium text-primary">设置</h1>
          </div>
          <nav className="no-drag flex flex-col gap-0.5">
            {(Object.keys(TAB_LABELS) as SettingsTab[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center rounded-full px-3 text-14 transition-colors select-none',
                  tab === id
                    ? 'bg-accent font-medium text-accent-fg'
                    : 'text-primary hover:bg-hover',
                )}
              >
                {TAB_LABELS[id]}
              </button>
            ))}
          </nav>
        </aside>

        {/* 内容列：max-w-[920px] 居中；pt-[56px] 与内栏首个 tab 顶对齐；切分区淡入 */}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pt-[56px] pr-6 pl-4 [scrollbar-gutter:stable]">
          <div key={tab} className="animate-fade-in mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32">
            {tab === 'general' && (
              <div className="flex flex-col gap-[14px]">
                <SectionTitle>通用</SectionTitle>
                <UserProfileCard />

                {/* 主题 */}
                <SectionCard>
                  <p className="text-13 font-medium text-secondary">主题</p>
                  <div
                    className="mt-3 flex gap-3"
                    role="radiogroup"
                    aria-label="主题"
                  >
                    {THEME_OPTIONS.map((o) => {
                      const selected = mode === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setMode(o.value)}
                          className="flex flex-1 flex-col items-center gap-2 select-none"
                        >
                          <div
                            className={cn(
                              'flex h-[72px] w-full items-center justify-center overflow-hidden rounded-xl',
                              selected ? 'border-2 border-primary' : 'border border-board',
                            )}
                            style={
                              o.value === 'system'
                                ? {
                                    background:
                                      'linear-gradient(90deg, #2A2828 0%, #2A2828 50%, #F2EBE1 50%, #F2EBE1 100%)',
                                  }
                                : { backgroundColor: o.previewBg }
                            }
                          >
                            {o.value === 'light' && (
                              <Sun size={28} strokeWidth={1.6} color="#3D3832" />
                            )}
                            {o.value === 'dark' && (
                              <Moon size={28} strokeWidth={1.6} color="#D4D4D4" />
                            )}
                            {o.value === 'system' && (
                              <Monitor size={28} strokeWidth={1.6} color="#737373" />
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span
                              className={cn(
                                'text-13 font-medium',
                                selected ? 'text-primary' : 'text-secondary',
                              )}
                            >
                              {o.label}
                            </span>
                            {selected ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                {/* 默认工作目录 */}
                <SectionCard>
                  <p className="text-13 font-medium text-secondary">默认工作目录</p>                  <p className="mt-1 text-12 text-muted">
                    新建会话的 agent 工作目录（会话在此目录读写文件）
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={workDir}
                      onChange={(e) => {
                        setWorkDir(e.target.value);
                        setDefaultWorkDir(e.target.value);
                      }}
                      placeholder={`如 D:\\AI\\${brand.name} 或 /home/you/projects`}
                      className={cn(FIELD_CLS, 'font-mono')}
                    />
                    <button
                      type="button"
                      className="h-10 shrink-0 rounded-xl border border-board px-3 text-13"
                      onClick={() => {
                        void window.fundet.pickDirectory().then((dir) => {
                          if (!dir) return;
                          setWorkDir(dir);
                          setDefaultWorkDir(dir);
                        });
                      }}
                    >
                      浏览
                    </button>
                  </div>
                </SectionCard>

                <FontFamilyPicker
                  label="界面字体"
                  description="菜单、设置、对话和其它界面文字"
                  value={uiFont}
                  presets={UI_FONT_PRESETS}
                  preview={`${brand.name} · The quick brown fox 0123456789`}
                  onChange={(f) => {
                    setUiFont(f);
                    setUiFontState(f);
                  }}
                  onReset={() => {
                    setUiFont('');
                    setUiFontState('');
                  }}
                />
                <FontFamilyPicker
                  label="代码字体"
                  description="代码块、终端式等宽文本"
                  value={codeFont}
                  presets={CODE_FONT_PRESETS}
                  preview={'const greet = (name: string) => `Hello, ${name}`;'}
                  onChange={(f) => {
                    setCodeFont(f);
                    setCodeFontState(f);
                  }}
                  onReset={() => {
                    setCodeFont('');
                    setCodeFontState('');
                  }}
                />

                <UpdateCard />
              </div>
            )}

            {tab === 'providers' && <ProvidersPanel />}

            {tab === 'automation' && (
              <div className="flex flex-col gap-[14px]">
                <SectionTitle>自动操作</SectionTitle>
                <BrowserSection />
                <ComputerSection />
              </div>
            )}

            {tab === 'usage' && <UsageHistoryPanel />}

            {tab === 'search' && <SearchPanel />}

            {tab === 'im' && <ImBotPanel />}

            {tab === 'skills' && <SkillsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
