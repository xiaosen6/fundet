/**
 * AutomationsPanel —— 自动化（定时例行任务）管理面板（对齐 Cindy 自动化页）。
 * 列表（名称/触发摘要/下次运行/状态/暂停开关/立即运行/删除）+ 新建/编辑
 * （触发器：每小时/每天/工作日/每周/每月/cron 表达式）+ 展开看运行历史。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  CalendarClock,
  ChevronDown,
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { AutomationInput, AutomationRunView, AutomationView } from '../../../../shared/automations.js';
import { automationScheduleSummary } from '../../../../shared/automations.js';
import type { ProviderView } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { getDefaultWorkDir } from '../../lib/defaults';

const SCHEDULES: Array<{ id: AutomationInput['schedule']; label: string }> = [
  { id: 'hourly', label: '每小时' },
  { id: 'interval', label: '间隔' },
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '工作日' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
  { id: 'cron', label: '自定义 cron' },
  { id: 'once', label: '一次' },
];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function fmtNext(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}
function fmtRunTime(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Draft {
  name: string;
  schedule: AutomationInput['schedule'];
  time: string;
  day: number;
  cron: string;
  intervalMinutes: number;
  model: string;
  providerId: string;
  instructions: string;
  workDir: string;
}
const emptyDraft = (): Draft => ({
  name: '',
  schedule: 'daily',
  time: '09:00',
  day: 1,
  cron: '0 9 * * 1-5',
  intervalMinutes: 30,
  model: '',
  providerId: '',
  instructions: '',
  workDir: getDefaultWorkDir(),
});

function draftFrom(a: AutomationView): Draft {
  return {
    name: a.name,
    schedule: a.schedule,
    time: a.time ?? '09:00',
    day: a.day ?? 1,
    cron: a.cron ?? '0 9 * * 1-5',
    intervalMinutes: a.intervalMinutes ?? 30,
    model: a.model ?? '',
    providerId: a.providerId ?? '',
    instructions: a.instructions,
    workDir: a.workDir,
  };
}
function toInput(d: Draft): AutomationInput {
  const needTime = ['daily', 'weekdays', 'weekly', 'monthly', 'once'].includes(d.schedule);
  return {
    name: d.name.trim() || d.instructions.slice(0, 20),
    schedule: d.schedule,
    time: needTime ? d.time : null,
    day: d.schedule === 'weekly' || d.schedule === 'monthly' ? d.day : null,
    cron: d.schedule === 'cron' ? d.cron : null,
    intervalMinutes: d.schedule === 'interval' ? d.intervalMinutes : null,
    model: d.model || null,
    providerId: d.providerId || null,
    instructions: d.instructions,
    workDir: d.workDir,
  };
}

export function AutomationsPanel(): React.JSX.Element {
  const [list, setList] = useState<AutomationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Record<string, AutomationRunView[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    setError('');
    try {
      setList(await window.fundet.automationsList());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void window.fundet.listProviders().then((p) => setProviders(p));
  }, [refresh]);

  const toggle = async (a: AutomationView): Promise<void> => {
    setList(await window.fundet.automationsSetPaused(a.id, a.status === 'active'));
  };
  const del = async (a: AutomationView): Promise<void> => {
    await window.fundet.automationsDelete(a.id);
    await refresh();
  };
  const runNow = async (a: AutomationView): Promise<void> => {
    setRunningNow(a.id);
    try {
      await window.fundet.automationsRunNow(a.id);
      setTimeout(() => void refresh(), 1500);
    } finally {
      setRunningNow(null);
    }
  };
  const toggleExpand = async (a: AutomationView): Promise<void> => {
    if (expanded === a.id) {
      setExpanded(null);
      return;
    }
    setExpanded(a.id);
    if (!runs[a.id]) {
      const r = await window.fundet.automationsRuns(a.id, 10);
      setRuns((m) => ({ ...m, [a.id]: r }));
    }
  };
  const save = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      const input = toInput(editing);
      if (editingId) await window.fundet.automationsUpdate(editingId, input);
      else await window.fundet.automationsCreate(input);
      setEditing(null);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const editorOpen = editing !== null;
  const runStatusTone = (s: AutomationRunView['status']): string =>
    s === 'success' ? 'text-success' : s === 'failed' ? 'text-error' : 'text-muted';

  return (
    <div className="flex flex-col gap-3">
      {/* 标题 + 新建 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-16 leading-[1.2] font-medium text-primary">自动化</h2>
          <p className="mt-1 text-12 text-muted">定时例行任务：到点自动起会话执行指令，结果进运行历史。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(emptyDraft());
            setEditingId(null);
          }}
          className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
        >
          <Plus size={13} /> 新建任务
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-board bg-card px-4 py-2.5 text-12 text-error">{error}</div>
      )}

      {/* 编辑器（弹层） */}
      {editorOpen && editing && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-neutral-900/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditing(null); setEditingId(null); } }}>
          <div className="flex max-h-[82vh] w-full max-w-[520px] flex-col rounded-xl border border-board bg-card shadow-[var(--shadow-menu)]">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <p className="text-16 font-medium text-primary">{editingId ? '编辑任务' : '新建任务'}</p>
              <button type="button" onClick={() => { setEditing(null); setEditingId(null); }} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-primary" aria-label="关闭">
                <X size={14} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
              <label className="flex flex-col gap-1">
                <span className="text-11 text-muted">名称（可选，默认取指令前 20 字）</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-9 rounded-lg border border-board bg-card px-3 text-13 text-primary outline-none focus:border-[var(--input-focus-border)]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-11 text-muted">指令</span>
                <textarea value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} rows={3} placeholder="例如：汇总我今天的钉钉日程并发给我" className="rounded-lg border border-board bg-card px-3 py-2 text-13 text-primary outline-none focus:border-[var(--input-focus-border)]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-11 text-muted">工作目录</span>
                <input value={editing.workDir} onChange={(e) => setEditing({ ...editing, workDir: e.target.value })} className="h-9 rounded-lg border border-board bg-card px-3 text-13 text-primary outline-none focus:border-[var(--input-focus-border)]" />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-11 text-muted">何时运行</span>
                <div className="flex flex-wrap gap-1.5">
                  {SCHEDULES.map((s) => (
                    <button key={s.id} type="button" onClick={() => setEditing({ ...editing, schedule: s.id })} className={cn('h-8 rounded-full px-3 text-12 transition-colors', editing.schedule === s.id ? 'bg-accent font-medium text-accent-fg' : 'border border-board text-secondary hover:text-primary')}>
                      {s.label}
                    </button>
                  ))}
                </div>
                {['daily', 'weekdays', 'weekly', 'monthly', 'once'].includes(editing.schedule) && (
                  <div className="flex items-center gap-2">
                    {editing.schedule === 'weekly' && (
                      <select value={editing.day} onChange={(e) => setEditing({ ...editing, day: Number(e.target.value) })} className="h-9 rounded-lg border border-board bg-card px-2 text-13 text-primary">
                        {WEEKDAYS.map((w, i) => <option key={i} value={i}>星期{w}</option>)}
                      </select>
                    )}
                    {editing.schedule === 'monthly' && (
                      <input type="number" min={1} max={31} value={editing.day} onChange={(e) => setEditing({ ...editing, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} className="h-9 w-20 rounded-lg border border-board bg-card px-2 text-13 text-primary" />
                    )}
                    <input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} className="h-9 rounded-lg border border-board bg-card px-2 text-13 text-primary" />
                  </div>
                )}
                {editing.schedule === 'interval' && (
                  <div className="flex items-center gap-2">
                    <span className="text-12 text-muted">上次运行完成后等</span>
                    <input type="number" min={1} value={editing.intervalMinutes} onChange={(e) => setEditing({ ...editing, intervalMinutes: Math.max(1, Number(e.target.value) || 1) })} className="h-9 w-24 rounded-lg border border-board bg-card px-2 text-13 text-primary" />
                    <span className="text-12 text-muted">分钟</span>
                  </div>
                )}
                {editing.schedule === 'cron' && (
                  <input value={editing.cron} onChange={(e) => setEditing({ ...editing, cron: e.target.value })} placeholder="分 时 日 月 周，如 0 9 * * 1-5" className="h-9 rounded-lg border border-board bg-card px-3 font-mono text-13 text-primary outline-none focus:border-[var(--input-focus-border)]" />
                )}
                {editing.schedule === 'once' && (
                  <p className="text-11 text-muted">到点运行一次后自动失效。</p>
                )}
              </div>
              {/* 模型（可选；空=默认） */}
              <label className="flex flex-col gap-1">
                <span className="text-11 text-muted">模型（可选；不填用当前默认）</span>
                <ModelPicker providers={providers} model={editing.model} providerId={editing.providerId} onChange={(model, providerId) => setEditing({ ...editing, model, providerId })} />
              </label>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-board/40 px-4 py-3">
              <button type="button" onClick={() => { setEditing(null); setEditingId(null); }} className="h-9 min-w-[88px] rounded-lg border border-board px-3 text-13 text-secondary hover:bg-hover">取消</button>
              <button type="button" disabled={saving || !editing.instructions.trim()} onClick={() => void save()} className="flex h-9 min-w-[88px] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-13 font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
                {saving && <Loader2 size={13} className="animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-13 text-muted">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有自动化任务。点右上角「新建任务」，让 agent 定时帮你干活（比如每天早上发日程晨报）。
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.map((a) => {
            const open = expanded === a.id;
            const runList = runs[a.id];
            return (
              <div key={a.id} className="fundet-surface flex flex-col rounded-container border border-board bg-card px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
                    <CalendarClock size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-medium text-primary" title={a.name}>{a.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-11 text-muted">
                      <span className="rounded-full bg-chip px-1.5 leading-4">{automationScheduleSummary(a)}</span>
                      {a.schedule === 'once' && (
                        <span className={cn('rounded-full px-1.5 leading-4', a.lastRunAt ? 'bg-hover-soft text-muted' : 'bg-hover-soft text-warning')}>
                          {a.lastRunAt ? '已运行' : '待运行'}
                        </span>
                      )}
                      {a.model && <span className="rounded-full bg-chip px-1.5 leading-4 tabular-nums">{a.model}</span>}
                      <span className="flex items-center gap-0.5"><Clock size={10} /> 下次 {fmtNext(a.nextRunAt)}</span>
                    </p>
                  </div>
                  <Switch.Root checked={a.status === 'active'} onCheckedChange={() => void toggle(a)} className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-board transition-colors data-[state=checked]:bg-accent" aria-label="启用/暂停">
                    <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
                  </Switch.Root>
                  <button type="button" onClick={() => void runNow(a)} disabled={runningNow === a.id} className="flex h-8 items-center gap-1 rounded-full border border-board px-2.5 text-12 text-secondary hover:text-primary disabled:opacity-50" title="立即运行一次">
                    {runningNow === a.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} 立即运行
                  </button>
                  <button type="button" onClick={() => { setEditing(draftFrom(a)); setEditingId(a.id); }} className="h-8 rounded-full border border-board px-2.5 text-12 text-secondary hover:text-primary">编辑</button>
                  <button type="button" onClick={() => void del(a)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-error" title="删除">
                    <Trash2 size={13} />
                  </button>
                  <button type="button" onClick={() => void toggleExpand(a)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-primary" aria-label="运行历史">
                    <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
                  </button>
                </div>
                {open && (
                  <div className="mt-2.5 border-t border-board/40 pt-2.5">
                    <p className="text-11 font-medium text-muted">运行历史（近 10 次）</p>
                    {!runList ? (
                      <p className="mt-1.5 text-11 text-muted">加载中…</p>
                    ) : runList.length === 0 ? (
                      <p className="mt-1.5 text-11 text-muted">这条任务还未运行。点「立即运行」或等下次定时触发。</p>
                    ) : (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {runList.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-11">
                            <span className={cn('w-12 shrink-0', runStatusTone(r.status))}>
                              {r.status === 'success' ? '成功' : r.status === 'failed' ? '失败' : r.status === 'running' ? '运行中' : '等待'}
                            </span>
                            <span className="text-muted tabular-nums">{fmtRunTime(r.startedAt)}</span>
                            {r.error && <span className="min-w-0 truncate text-error" title={r.error}>{r.error}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 模型选择（可选）：第一个 option=默认，其余 provider 的启用模型 */
function ModelPicker({
  providers,
  model,
  providerId,
  onChange,
}: {
  providers: ProviderView[];
  model: string;
  providerId: string;
  onChange: (model: string, providerId: string) => void;
}): React.JSX.Element {
  const value = model && providerId ? `${providerId}::${model}` : '';
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange('', '');
        const [pid, mid] = v.split('::');
        onChange(mid ?? '', pid ?? '');
      }}
      className="h-9 rounded-lg border border-board bg-card px-2 text-13 text-primary"
    >
      <option value="">默认（当前 provider 首启用模型）</option>
      {providers.flatMap((p) =>
        p.models.filter((m) => m.enabled !== false).map((m) => (
          <option key={`${p.id}::${m.id}`} value={`${p.id}::${m.id}`}>
            {p.name} · {m.id}
          </option>
        )),
      )}
    </select>
  );
}
