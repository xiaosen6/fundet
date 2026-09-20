/**
 * 技能面板 —— 「已安装」/「发现」双 tab。
 * 已安装：本地技能列表（导入/启停/卸载）+ SkillHub 可更新角标。
 * 发现（SkillHub 集市 skillhub.cn）：热门/搜索/分类/排序 + 详情（审计徽标）+ 一键安装，
 * 卡片语言与知识库/组件板同款（fundet-surface 材质 + rise-in 交错入场 + Reveal 展开）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  BadgeCheck,
  ChevronDown,
  Download,
  Flame,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { SkillView } from '../../../../shared/fundet-api.js';
import type {
  SkillhubDetailView,
  SkillhubSkillView,
  SkillhubSort,
  SkillhubUpdateView,
} from '../../../../shared/skillhub.js';
import { skillhubIconProxyUrl } from '../../../../shared/skillhub.js';
import { cn } from '../../lib/cn';
import { getDefaultWorkDir } from '../../lib/defaults';

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const SORTS: Array<{ id: SkillhubSort; label: string }> = [
  { id: 'downloads', label: '最多下载' },
  { id: 'trending', label: '趋势' },
  { id: 'stars', label: '星标' },
  { id: 'score', label: '评分' },
];

/* ---------------- 发现（SkillHub 集市） ---------------- */

function SkillIcon({ url, name, size = 44 }: { url: string | null; name: string; size?: number }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  // 远程图标经主进程代理协议（白名单 CDN + 磁盘缓存）；CSP 不放行 https 直连
  const src = skillhubIconProxyUrl(url);
  const shape = size >= 56 ? 'rounded-2xl' : 'rounded-xl';
  if (!src || broken) {
    return (
      <span
        style={{ height: size, width: size }}
        className={`flex shrink-0 items-center justify-center bg-chip text-secondary ring-1 ring-white/10 ${shape}`}
      >
        <Zap size={Math.round(size * 0.42)} strokeWidth={2} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      style={{ height: size, width: size }}
      className={`shrink-0 border border-board object-cover ring-1 ring-white/10 ${shape}`}
    />
  );
}

function auditTone(status: string): string {
  if (/benign|pass|safe/i.test(status)) return 'text-success';
  if (/unknown|none/i.test(status)) return 'text-muted';
  return 'text-warning';
}

function DiscoverSkills({
  installedDirs,
  updates,
  onInstalled,
}: {
  installedDirs: Set<string>;
  updates: Map<string, SkillhubUpdateView>;
  onInstalled: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<SkillhubSort>('downloads');
  const [category, setCategory] = useState('all');
  const [list, setList] = useState<SkillhubSkillView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SkillhubDetailView | null>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const seq = useRef(0);

  // 搜索防抖 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async (): Promise<void> => {
    const id = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const r = await window.fundet.skillhubList({ keyword: debounced, sort, category, limit: 30 });
      if (seq.current !== id) return; // 过期响应丢弃
      setList(r);
    } catch (err) {
      if (seq.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
      setList([]);
    } finally {
      if (seq.current === id) setLoading(false);
    }
  }, [debounced, sort, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of list) if (s.category) seen.set(s.category, (seen.get(s.category) ?? 0) + 1);
    return ['all', ...[...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)];
  }, [list]);

  const expand = async (slug: string): Promise<void> => {
    if (expanded === slug) {
      setExpanded(null);
      return;
    }
    setExpanded(slug);
    if (details[slug] === undefined) {
      setDetails((d) => ({ ...d, [slug]: null }));
      try {
        const det = await window.fundet.skillhubDetail(slug);
        setDetails((d) => ({ ...d, [slug]: det }));
      } catch {
        setDetails((d) => ({ ...d, [slug]: null }));
      }
    }
  };

  const install = async (slug: string): Promise<void> => {
    setError('');
    setInstalling(slug);
    try {
      await window.fundet.skillhubInstall(slug, installedDirs.has(slug));
      onInstalled();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 搜索 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能（如：pdf、测试、浏览器）"
            className="h-9 w-full rounded-full border border-board bg-card pr-3 pl-8 text-13 text-primary placeholder:text-placeholder focus:border-[var(--input-focus-border)] focus:outline-none"
          />
        </div>
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSort(s.id)}
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-3 text-12 transition-colors',
              sort === s.id ? 'bg-accent font-medium text-accent-fg' : 'border border-board text-secondary hover:text-primary',
            )}
          >
            {s.id === 'trending' && <Flame size={12} />}
            {s.label}
          </button>
        ))}
      </div>

      {/* 分类 chips（从结果动态聚合） */}
      {categories.length > 2 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.slice(0, 10).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'h-7 rounded-full px-2.5 text-11 transition-colors',
                category === c ? 'bg-accent font-medium text-accent-fg' : 'bg-chip text-secondary hover:text-primary',
              )}
            >
              {c === 'all' ? '全部分类' : c}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-board bg-card px-4 py-2.5 text-12 text-error">
          <span className="min-w-0 truncate" title={error}>{error}</span>
          <button type="button" onClick={() => void load()} className="shrink-0 text-secondary hover:text-primary">
            重试
          </button>
        </div>
      )}

      {loading && list.length === 0 ? (
        <div className="flex h-40 items-center justify-center gap-2 text-13 text-muted">
          <Loader2 size={14} className="animate-spin" />
          正在从 SkillHub 拉取…
        </div>
      ) : list.length === 0 && !error ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          没有匹配的技能。换个关键词或分类试试。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((s, idx) => {
            const open = expanded === s.slug;
            const installed = installedDirs.has(s.slug);
            const upd = updates.get(s.slug);
            const det = details[s.slug];
            return (
              <div
                key={s.slug}
                className={cn(
                  'group animate-fundet-rise-in fundet-surface flex min-w-0 flex-col rounded-container border border-board bg-card px-4 py-3.5 select-none',
                  open ? 'border-[var(--input-focus-border)]' : 'hover:border-[var(--input-focus-border)]',
                )}
                style={{ animationDelay: `${Math.min(idx, 8) * 50}ms` }}
              >
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => void expand(s.slug)}>
                  <div className="flex items-center gap-2.5">
                    <SkillIcon url={s.iconUrl} name={s.name} />
                    <span className="min-w-0 flex-1 truncate text-13 font-medium text-primary" title={s.name}>
                      {s.name}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn('shrink-0 text-muted transition-transform duration-[var(--motion-fast)]', open && 'rotate-180')}
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-12 leading-relaxed text-secondary">{s.description || '（无描述）'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-11 text-muted">
                    <span className="rounded-full bg-chip px-1.5 leading-4 tabular-nums">{fmtCount(s.downloads)} 下载</span>
                    {s.category && <span className="rounded-full bg-chip px-1.5 leading-4">{s.category}</span>}
                    {s.requiresApiKey && <span className="rounded-full bg-hover-soft px-1.5 leading-4 text-warning">需 API Key</span>}
                    {s.owner && <span className="truncate">@{s.owner}</span>}
                  </div>
                </button>

                {/* 展开详情：审计徽标 / 版本 / 概览 / 安装 */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-[var(--motion-base)] ease-[var(--motion-ease-move)]',
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-2.5 flex flex-col gap-2 border-t border-board/40 pt-2.5">
                      {det === undefined || det === null ? (
                        <p className="text-11 text-muted">{det === undefined ? '加载详情…' : '详情暂不可用'}</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5 text-11">
                            <span className="rounded-full bg-chip px-1.5 leading-4 tabular-nums">v{det.latestVersion ?? '?'}</span>
                            {det.verified && (
                              <span className="flex items-center gap-0.5 text-success">
                                <BadgeCheck size={11} /> 作者已验证
                              </span>
                            )}
                            {det.securityReports.length > 0 ? (
                              det.securityReports.slice(0, 3).map((r) => (
                                <span key={r.provider} className={cn('flex items-center gap-0.5', auditTone(r.status))} title={r.reportUrl ?? undefined}>
                                  <ShieldCheck size={11} />
                                  {r.statusText ?? r.provider}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted">暂无安全审计</span>
                            )}
                          </div>
                          {det.changelog && <p className="text-11 text-muted">更新日志：{det.changelog.slice(0, 80)}</p>}
                          {det.tags.length > 0 && (
                            <p className="truncate text-11 text-muted">{det.tags.map((t) => `#${t}`).join(' ')}</p>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        disabled={installing !== null}
                        onClick={() => void install(s.slug)}
                        className={cn(
                          'flex h-7 w-fit items-center gap-1 rounded-full px-3 text-12 font-medium transition-colors',
                          installed ? 'border border-board text-secondary hover:text-primary' : 'bg-accent text-accent-fg',
                          installing === s.slug && 'opacity-60',
                        )}
                      >
                        {installing === s.slug ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        {installing === s.slug ? '安装中…' : installed ? (upd ? `更新到 v${upd.latest}` : '重新安装') : '安装'}
                      </button>
                    </div>
                  </div>
                </div>

                {installed && !open && (
                  <span className="mt-2 w-fit rounded-full bg-hover-soft px-2 py-px text-11 text-success">
                    已安装{upd ? ` · 可更新 v${upd.latest}` : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- 面板主体 ---------------- */

export function SkillsPanel(): React.JSX.Element {
  const workDir = getDefaultWorkDir();
  const [tab, setTab] = useState<'installed' | 'discover'>('installed');
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<Map<string, SkillhubUpdateView>>(new Map());

  const refresh = useCallback(async (): Promise<void> => {
    setSkills(await window.fundet.listSkills(workDir || undefined));
  }, [workDir]);

  const refreshUpdates = useCallback(async (): Promise<void> => {
    try {
      const list = await window.fundet.skillhubUpdates();
      setUpdates(new Map(list.map((u) => [u.slug, u])));
    } catch {
      setUpdates(new Map()); // 更新检查失败不阻断浏览
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshUpdates();
  }, [refresh, refreshUpdates]);

  /** 已装目录名集合（skillhub 安装的目录名 = slug） */
  const installedDirs = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) {
      const base = s.path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
      if (base) set.add(base);
    }
    return set;
  }, [skills]);

  /** skillhub 装的且当前在列表里的（按目录名对上）→ 显示可更新角标 */
  const updateFor = (skill: SkillView): SkillhubUpdateView | undefined => {
    const base = skill.path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    return base ? updates.get(base) : undefined;
  };

  const importAt = async (scope: 'user' | 'project'): Promise<void> => {
    setError('');
    if (scope === 'project' && !workDir.trim()) {
      setError('导入到项目前，请先在「通用」里设置默认工作目录');
      return;
    }
    const file = await window.fundet.pickSkillFile();
    if (!file) return;
    setBusy(true);
    try {
      await window.fundet.importSkill(file, scope, workDir || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: SkillView): Promise<void> => {
    setError('');
    try {
      await window.fundet.uninstallSkill(skill.path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateSkillhub = async (slug: string): Promise<void> => {
    setError('');
    try {
      await window.fundet.skillhubInstall(slug, true);
      await Promise.all([refresh(), refreshUpdates()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const afterInstall = (): void => {
    void refresh();
    void refreshUpdates();
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>技能</SectionTitle>
          <p className="mt-1 text-13 text-secondary">
            {tab === 'installed'
              ? '开关停用后新会话不再加载。输入框输入 / 可点名技能，发送时写成 /skill:名字。'
              : '来自 SkillHub（skillhub.cn）的公开技能集市。安装前可展开查看安全审计与版本；一键安装经逐文件校验后落盘本机。'}
          </p>
        </div>
        {tab === 'installed' && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void importAt('user')}
              className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
            >
              <Plus size={13} />
              导入到全局
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void importAt('project')}
              className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 font-medium text-primary"
            >
              导入到项目
            </button>
          </div>
        )}
      </div>

      {/* 双 tab */}
      <div className="flex items-center gap-1.5">
        {(
          [
            ['installed', '已安装'],
            ['discover', '发现'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-3.5 text-13 transition-colors',
              tab === id ? 'bg-accent font-medium text-accent-fg' : 'text-secondary hover:bg-hover hover:text-primary',
            )}
          >
            {id === 'discover' && <Sparkles size={12} />}
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-12 text-error">{error}</p>}

      {tab === 'discover' ? (
        <DiscoverSkills installedDirs={installedDirs} updates={updates} onInstalled={afterInstall} />
      ) : skills.length === 0 ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有技能。到「发现」页一键安装，或导入一份带 name / description frontmatter 的 SKILL.md。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((s) => {
            const enabled = s.enabled !== false;
            const upd = updateFor(s);
            return (
              <div
                key={s.path}
                className={`flex items-start gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3 ${enabled ? '' : 'opacity-60'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-14 font-medium ${enabled ? 'text-primary' : 'text-muted'}`}>{s.name}</span>
                    <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">
                      {s.bundled ? '内置' : s.scope === 'user' ? '全局' : '项目'}
                    </span>
                    {!enabled && <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">已停用</span>}
                    {upd && (
                      <button
                        type="button"
                        onClick={() => void updateSkillhub(upd.slug)}
                        className="flex items-center gap-1 rounded-full bg-hover-soft px-2 py-0.5 text-11 text-success transition-colors hover:text-primary"
                        title={`当前 v${upd.current} → 最新 v${upd.latest}，点击更新`}
                      >
                        <RefreshCw size={11} />
                        更新 v{upd.latest}
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-12 text-secondary">{s.description}</p>
                  <p className="mt-1 truncate font-mono text-11 text-muted">{s.path}</p>
                </div>
                {!s.bundled && (
                  <button
                    type="button"
                    title="卸载"
                    onClick={() => void remove(s)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-error"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <Switch.Root
                  checked={enabled}
                  onCheckedChange={(v) => {
                    setError('');
                    void window.fundet
                      .setSkillEnabled(s.path, v)
                      .then(refresh)
                      .catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        void refresh();
                      });
                  }}
                  title={enabled ? '停用（新会话不再加载）' : '启用'}
                  className="mt-1 h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
                >
                  <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
                </Switch.Root>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
