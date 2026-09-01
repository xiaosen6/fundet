/**
 * UsageDashboard — 首页「用量与开销」仪表盘（对齐 Cindy HomeUsageDashboard 形态）。
 *
 * 三个区块:
 *   1. 统计条: 今日花费 / Token(今日/近30天) / 连续活跃 / 近 30 天总额。
 *      今日花费 > 2× 前 7 日均值且 ≥$1 时今日格 warning 色 + tooltip。
 *   2. 活跃热力图: 近 20 周 GitHub 风格，强度 = 当日花费（无花费日按 token 兜底）。
 *   3. 近 30 天每日堆叠柱状图（按模型分段，柱高 = 日花费；全程无花费时高度回退 token）。
 *
 * 数据: main 侧 usage_daily（turn 增量累计，USD），本组件聚合渲染。
 * 空态不渲染整卡（BYOK 新用户无数据不占位）。折叠态存 localStorage。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

interface UsageRow {
  day: string;
  model: string;
  tokens: number;
  costUsd: number;
}

const WINDOW_DAYS = 30;
const HEATMAP_DAYS = 140;
const HEAT_CELL = 12;
const HEAT_GAP = 3;
const HEAT_LEVEL_MIX = [0.22, 0.42, 0.68, 1];
const COLLAPSED_KEY = 'homeUsageDashboard.collapsed';
const PALETTE = ['#417CDD', '#EA6B17', '#3F9C6B', '#8B5CF6', '#D95565', '#0EA5A5', '#B7791F'];

function localDayKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDay(key: string, delta: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + delta);
  return toDayKey(d);
}

function fmtCompactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtMoney(usd: number): string {
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${Math.round(usd)}`;
}

function fmtDayLabel(key: string): string {
  const d = parseDayKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function modelColor(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

/** 统计格: 值上（14px semibold）标签下（11px muted） */
function StatCell({ value, label, warning }: { value: string; label: string; warning?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg bg-chip px-3 py-2">
      <span className={cn('truncate text-14 font-semibold tabular-nums', warning ? 'text-warning' : 'text-primary')}>
        {value}
      </span>
      <span className="truncate text-11 text-muted">{label}</span>
    </div>
  );
}

interface DayCell {
  day: string;
  intensity: number;
  tokens: number;
  level: number;
  placeholder: boolean;
}

function Heatmap({ rows, today }: { rows: UsageRow[]; today: string }): React.JSX.Element {
  const { columns, monthLabels } = useMemo(() => {
    const costByDay = new Map<string, number>();
    const tokenByDay = new Map<string, number>();
    for (const r of rows) {
      costByDay.set(r.day, (costByDay.get(r.day) ?? 0) + r.costUsd);
      tokenByDay.set(r.day, (tokenByDay.get(r.day) ?? 0) + r.tokens);
    }
    const nonZero = rows
      .reduce<Array<number>>((acc, r) => {
        const dayCost = costByDay.get(r.day) ?? 0;
        if (dayCost > 0 && !acc.includes(dayCost)) acc.push(dayCost);
        return acc;
      }, [])
      .sort((a, b) => a - b);
    const q = (p: number): number => (nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))] : 0);
    const thresholds: [number, number, number] = [q(0.25), q(0.5), q(0.75)];
    const levelFor = (cost: number): number => {
      if (cost <= 0) return 0;
      if (cost <= thresholds[0]) return 1;
      if (cost <= thresholds[1]) return 2;
      if (cost <= thresholds[2]) return 3;
      return 4;
    };

    const start = parseDayKey(today);
    start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
    start.setDate(start.getDate() - start.getDay()); // 行 = 周日起

    const cells: DayCell[] = [];
    const cursor = new Date(start);
    while (cursor <= parseDayKey(today)) {
      const key = toDayKey(cursor);
      const cost = costByDay.get(key) ?? 0;
      cells.push({
        day: key,
        intensity: cost,
        tokens: tokenByDay.get(key) ?? 0,
        level: levelFor(cost),
        placeholder: false,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: '', intensity: 0, tokens: 0, level: 0, placeholder: true });
    }
    const cols: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));

    const labels: Array<{ col: number; text: string }> = [];
    cols.forEach((col, idx) => {
      const first = col.find((c) => !c.placeholder && c.day.endsWith('-01'));
      if (!first) return;
      if (labels.length > 0 && idx - labels[labels.length - 1].col < 2) return;
      labels.push({ col: idx, text: `${parseDayKey(first.day).getMonth() + 1}月` });
    });
    return { columns: cols, monthLabels: labels };
  }, [rows, today]);

  const pitch = HEAT_CELL + HEAT_GAP;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[14px]" style={{ width: columns.length * pitch - HEAT_GAP }}>
        {monthLabels.map((m) => (
          <span key={`${m.col}-${m.text}`} className="absolute top-0 text-10 text-muted" style={{ left: m.col * pitch }}>
            {m.text}
          </span>
        ))}
      </div>
      <div className="flex" style={{ gap: HEAT_GAP }}>
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col" style={{ gap: HEAT_GAP }}>
            {col.map((cell, ri) =>
              cell.placeholder ? (
                <div key={ri} style={{ width: HEAT_CELL, height: HEAT_CELL }} />
              ) : (
                <div
                  key={ri}
                  title={`${cell.day} · ${fmtMoney(cell.intensity)}${cell.tokens > 0 ? ` · ${fmtCompactTokens(cell.tokens)} token` : ''}`}
                  className="rounded-[3px]"
                  style={{
                    width: HEAT_CELL,
                    height: HEAT_CELL,
                    backgroundColor:
                      cell.level === 0 ? 'var(--surface-chip, rgba(0,0,0,0.05))' : `color-mix(in srgb, var(--accent) ${HEAT_LEVEL_MIX[cell.level - 1] * 100}%, var(--surface-chip, rgba(0,0,0,0.05)))`,
                  }}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageDashboard(): React.JSX.Element | null {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    void window.fundet
      .usageHistory(HEATMAP_DAYS)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const today = localDayKey();
    const dayMap = new Map<string, { cost: number; tokens: number; models: Map<string, { tokens: number; cost: number }> }>();
    for (const r of rows) {
      let d = dayMap.get(r.day);
      if (!d) {
        d = { cost: 0, tokens: 0, models: new Map() };
        dayMap.set(r.day, d);
      }
      d.cost += r.costUsd;
      d.tokens += r.tokens;
      const m = d.models.get(r.model) ?? { tokens: 0, cost: 0 };
      m.tokens += r.tokens;
      m.cost += r.costUsd;
      d.models.set(r.model, m);
    }
    // 30 天柱（补空日）
    const days: Array<{ day: string; cost: number; tokens: number; models: Map<string, { tokens: number; cost: number }> }> = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const key = shiftDay(today, -i);
      const d = dayMap.get(key);
      days.push({ day: key, cost: d?.cost ?? 0, tokens: d?.tokens ?? 0, models: d?.models ?? new Map() });
    }
    const last30 = days.reduce((a, d) => ({ cost: a.cost + d.cost, tokens: a.tokens + d.tokens }), { cost: 0, tokens: 0 });
    if (last30.tokens <= 0) return null;
    const todayEntry = dayMap.get(today) ?? { cost: 0, tokens: 0, models: new Map() };
    // 连续活跃（今天或昨天起算，往前数有 token 的天）
    let streakCurrent = 0;
    {
      let cursor = dayMap.has(today) ? today : shiftDay(today, -1);
      while (dayMap.get(cursor)?.tokens) {
        streakCurrent += 1;
        cursor = shiftDay(cursor, -1);
      }
    }
    let streakLongest = 0;
    {
      const keys = [...dayMap.keys()].filter((k) => (dayMap.get(k)?.tokens ?? 0) > 0).sort();
      let run = 0;
      let prev: string | null = null;
      for (const k of keys) {
        run = prev && shiftDay(prev, 1) === k ? run + 1 : 1;
        streakLongest = Math.max(streakLongest, run);
        prev = k;
      }
    }
    // 异常: 今日花费 > 2× 前 7 日均值且 ≥$1
    let trailing7Avg = 0;
    for (let i = 1; i <= 7; i++) trailing7Avg += dayMap.get(shiftDay(today, -i))?.cost ?? 0;
    trailing7Avg /= 7;
    const anomaly = todayEntry.cost > 2 * trailing7Avg && todayEntry.cost >= 1;
    // 全程无花费 → 柱高回退 token
    const barsByCost = days.some((d) => d.cost > 0);
    const topModels = [...rows.reduce((m, r) => { m.set(r.model, (m.get(r.model) ?? 0) + r.tokens); return m; }, new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([m]) => m);
    return { today, days, last30, todayEntry, streakCurrent, streakLongest, anomaly, trailing7Avg, barsByCost, topModels };
  }, [rows]);

  if (!view) return null;

  const barValue = (d: { cost: number; tokens: number }): number => (view.barsByCost ? d.cost : d.tokens);
  const maxBar = Math.max(...view.days.map(barValue), 1);

  return (
    <div
      onClick={collapsed ? () => { setCollapsed(false); try { localStorage.setItem(COLLAPSED_KEY, '0'); } catch { /* ignore */ } } : undefined}
      className={cn(
        'w-full rounded-xl border border-board bg-card-ivory p-3.5',
        collapsed && 'cursor-pointer transition-colors hover:bg-hover-soft',
      )}
    >
      {/* 头部: 标题 +（折叠态）摘要 + chevron */}
      <div className={cn('flex items-center justify-between gap-3', !collapsed && 'mb-2.5')}>
        <span className="shrink-0 text-12 font-medium text-secondary">用量与开销</span>
        {collapsed && (
          <span className="min-w-0 flex-1 truncate text-right text-11 tabular-nums text-muted">
            <span className={cn(view.anomaly && 'font-medium text-warning')}>今日 {fmtMoney(view.todayEntry.cost)}</span>
            {' · '}
            {`Token ${fmtCompactTokens(view.todayEntry.tokens)}`}
            {' · '}
            {`连续 ${view.streakCurrent} 天`}
            {' · '}
            {`近 30 天 ${fmtMoney(view.last30.cost)}`}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const next = !collapsed;
            setCollapsed(next);
            try {
              localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
            } catch {
              /* ignore */
            }
          }}
          aria-label={collapsed ? '展开' : '收起'}
          className="flex size-[22px] shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-chip hover:text-secondary"
        >
          <ChevronDown size={14} className={cn('transition-transform duration-200', collapsed && '-rotate-90')} />
        </button>
      </div>

      {/* 统计条 */}
      {!collapsed && (
        <div className="flex gap-2">
          <StatCell value={fmtMoney(view.todayEntry.cost)} label="今日花费" warning={view.anomaly} />
          <StatCell
            value={`${fmtCompactTokens(view.todayEntry.tokens)} / ${fmtCompactTokens(view.last30.tokens)}`}
            label="Token（今日 / 近 30 天）"
          />
          <StatCell value={`${view.streakCurrent} 天 · 最长 ${view.streakLongest} 天`} label="连续活跃" />
          <StatCell value={fmtMoney(view.last30.cost)} label="近 30 天总额" />
        </div>
      )}

      {/* 热力图 + 每日堆叠柱 */}
      {!collapsed && rows && (
        <div className="mt-3.5 flex items-start gap-5">
          <Heatmap rows={rows} today={view.today} />
          <div className="min-w-0 flex-1 self-stretch border-l border-board pl-5">
            <div className="mb-1.5 text-11 text-muted">近 30 天每日花费{!view.barsByCost && '（按 token）'}</div>
            <div className="flex h-[96px] items-end gap-[3px]" aria-label="近 30 天每日花费">
              {view.days.map((d) => {
                const v = barValue(d);
                const h = Math.round((v / maxBar) * 96);
                const modelEntries = [...d.models.entries()];
                const detail = modelEntries
                  .sort((a, b) => b[1].tokens - a[1].tokens)
                  .map(([m, x]) => `${shortModel(m)} ${fmtCompactTokens(x.tokens)}`)
                  .join('，');
                return (
                  <div
                    key={d.day}
                    className="flex min-w-0 flex-1 flex-col justify-end"
                    style={{ height: 96 }}
                    title={`${fmtDayLabel(d.day)} · ${v > 0 ? (view.barsByCost ? fmtMoney(d.cost) : `${fmtCompactTokens(d.tokens)} token`) : '无用量'}${detail ? `（${detail}）` : ''}`}
                  >
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-[2px]"
                      style={{ height: Math.max(h, v > 0 ? 2 : 0) }}
                    >
                      {modelEntries
                        .sort((a, b) => (view.barsByCost ? b[1].cost - a[1].cost : b[1].tokens - a[1].tokens))
                        .map(([m, x]) => (
                          <div
                            key={m}
                            style={{
                              height: `${(view.barsByCost ? (d.cost > 0 ? x.cost / d.cost : 0) : d.tokens > 0 ? x.tokens / d.tokens : 0) * 100}%`,
                              backgroundColor: modelColor(m),
                              opacity: 0.85,
                            }}
                          />
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 模型图例 */}
            {view.topModels.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {view.topModels.map((m) => (
                  <span key={m} className="flex items-center gap-1 text-10 text-muted">
                    <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: modelColor(m) }} />
                    {shortModel(m)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
