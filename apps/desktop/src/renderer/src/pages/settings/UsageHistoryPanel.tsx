/**
 * UsageHistoryPanel — 设置 → 用量历史（对齐 Cindy 同名设置页形态）。
 *
 * 区块: 概览 5 格（今日/近30天 token、连续活跃、缓存命中率、用到的模型）
 * + 活跃热力图（近 20 周，强度 = 当日 token）
 * + 近 30 天每日 token 堆叠柱（带 y 轴刻度）
 * + 按 Agent/harness 表（本应用只有 pi）
 * + 按模型表（总 token/占比条/输入/输出/缓存读取/缓存写入/缓存命中率）。
 *
 * 缓存命中率 = cacheRead / (input + output + cacheRead + cacheWrite)；
 * 拆分数据自 0005 迁移起积累，之前为 0 → 命中率显示「—」。
 * 无任何数据时渲染空态说明（Cindy 同款提示口径）。
 */
import { useEffect, useMemo, useState } from 'react';
import { brand } from '../../../../shared/brand.ts';

interface UsageRow {
  day: string;
  model: string;
  tokens: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const HEATMAP_DAYS = 140;
const WINDOW_DAYS = 30;
const PALETTE = ['#417CDD', '#EA6B17', '#3F9C6B', '#8B5CF6', '#D95565', '#0EA5A5', '#B7791F', '#8A6A50'];

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

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function modelColor(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

function StatCell({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg bg-chip px-3 py-2">
      <span className="truncate text-14 font-semibold tabular-nums text-primary">{value}</span>
      <span className="truncate text-11 text-muted">{label}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-board bg-card-ivory p-4">
      <p className="mb-3 text-13 font-medium text-secondary">{title}</p>
      {children}
    </div>
  );
}

export function UsageHistoryPanel(): React.JSX.Element {
  const [rows, setRows] = useState<UsageRow[] | null>(null);

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
    if (rows === null) return null;
    const today = localDayKey();
    const dayMap = new Map<string, { tokens: number; cost: number; models: Map<string, UsageRow> }>();
    const modelMap = new Map<string, { tokens: number; input: number; output: number; cacheRead: number; cacheWrite: number; days: Set<string> }>();
    for (const r of rows) {
      let d = dayMap.get(r.day);
      if (!d) {
        d = { tokens: 0, cost: 0, models: new Map() };
        dayMap.set(r.day, d);
      }
      d.tokens += r.tokens;
      d.cost += r.costUsd;
      d.models.set(r.model, r);
      const m = modelMap.get(r.model) ?? { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, days: new Set<string>() };
      m.tokens += r.tokens;
      m.input += r.inputTokens;
      m.output += r.outputTokens;
      m.cacheRead += r.cacheReadTokens;
      m.cacheWrite += r.cacheWriteTokens;
      m.days.add(r.day);
      modelMap.set(r.model, m);
    }
    const models = [...modelMap.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
    if (models.length === 0) return { empty: true as const };

    // 连续活跃
    let streakCurrent = 0;
    {
      let cursor = dayMap.has(today) ? today : shiftDay(today, -1);
      while ((dayMap.get(cursor)?.tokens ?? 0) > 0) {
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

    // 30 天柱数据
    const days: Array<{ day: string; tokens: number; models: Map<string, number> }> = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const key = shiftDay(today, -i);
      const d = dayMap.get(key);
      const modelsToday = new Map<string, number>();
      let tokens = 0;
      if (d) {
        tokens = d.tokens;
        for (const [m, r] of d.models) modelsToday.set(m, r.tokens);
      }
      days.push({ day: key, tokens, models: modelsToday });
    }
    const last30Tokens = days.reduce((a, d) => a + d.tokens, 0);
    const todayTokens = dayMap.get(today)?.tokens ?? 0;
    // 缓存命中率（近 30 天窗口内有拆分数据的行）
    const winStart = shiftDay(today, -(30 - 1));
    let split = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const r of rows) {
      if (r.day < winStart) continue;
      split.input += r.inputTokens;
      split.output += r.outputTokens;
      split.cacheRead += r.cacheReadTokens;
      split.cacheWrite += r.cacheWriteTokens;
    }
    const splitTotal = split.input + split.output + split.cacheRead + split.cacheWrite;
    const cacheHitRate = splitTotal > 0 ? split.cacheRead / splitTotal : null;

    // 热力图 20 周
    const heatStart = parseDayKey(today);
    heatStart.setDate(heatStart.getDate() - (HEATMAP_DAYS - 1));
    heatStart.setDate(heatStart.getDate() - heatStart.getDay());
    const heatCells: Array<{ day: string; tokens: number; level: number; placeholder: boolean }> = [];
    {
      const nonzero = rows.map((r) => r.tokens).filter((v) => v > 0).sort((a, b) => a - b);
      const q = (p: number): number => (nonzero.length ? nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] : 0);
      const th: [number, number, number] = [q(0.25), q(0.5), q(0.75)];
      const levelFor = (t: number): number => (t <= 0 ? 0 : t <= th[0] ? 1 : t <= th[1] ? 2 : t <= th[2] ? 3 : 4);
      const cursor = new Date(heatStart);
      while (cursor <= parseDayKey(today)) {
        const key = toDayKey(cursor);
        const t = dayMap.get(key)?.tokens ?? 0;
        heatCells.push({ day: key, tokens: t, level: levelFor(t), placeholder: false });
        cursor.setDate(cursor.getDate() + 1);
      }
      while (heatCells.length % 7 !== 0) heatCells.push({ day: '', tokens: 0, level: 0, placeholder: true });
    }
    const heatCols: Array<Array<{ day: string; tokens: number; level: number; placeholder: boolean }>> = [];
    for (let i = 0; i < heatCells.length; i += 7) heatCols.push(heatCells.slice(i, i + 7));
    const heatLabels: Array<{ col: number; text: string }> = [];
    heatCols.forEach((col, idx) => {
      const first = col.find((c) => !c.placeholder && c.day.endsWith('-01'));
      if (!first) return;
      if (heatLabels.length > 0 && idx - heatLabels[heatLabels.length - 1].col < 2) return;
      heatLabels.push({ col: idx, text: `${parseDayKey(first.day).getMonth() + 1}月` });
    });

    return {
      empty: false as const,
      today,
      todayTokens,
      last30Tokens,
      streakCurrent,
      streakLongest,
      cacheHitRate,
      modelCount: models.length,
      days,
      heatCols,
      heatLabels,
      models: models.map(([model, m]) => ({ model, ...m })),
    };
  }, [rows]);

  if (view === null) {
    return (
      <div className="text-13 text-muted" style={{ paddingTop: 8 }}>
        加载中…
      </div>
    );
  }

  if (view.empty) {
    return (
      <div className="text-13 leading-relaxed text-muted" style={{ paddingTop: 8 }}>
        这台设备上{brand.name}内部产生的 token 用量。记录从该功能上线起积累，不回填更早的历史。
        目前还没有任何用量记录——开始对话后这里会出现统计。
      </div>
    );
  }

  const heatCell = 11;
  const heatGap = 3;
  const barMax = Math.max(...view.days.map((d) => d.tokens), 1);
  const total30 = view.last30Tokens;

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 860 }}>
      <p className="text-13 leading-relaxed text-muted">
        这台设备上{brand.name}内部产生的 token 用量。记录从该功能上线起积累，不回填更早的历史。
      </p>

      {/* 概览 */}
      <SectionCard title="概览">
        <div className="flex gap-2">
          <StatCell value={fmtCompact(view.todayTokens)} label="今日 token" />
          <StatCell value={fmtCompact(view.last30Tokens)} label="近 30 天 token" />
          <StatCell value={`${view.streakCurrent} 天 · 最长 ${view.streakLongest} 天`} label="连续活跃天数" />
          <StatCell
            value={view.cacheHitRate === null ? '—' : `${(view.cacheHitRate * 100).toFixed(1)}%`}
            label="缓存命中率（近 30 天）"
          />
          <StatCell value={String(view.modelCount)} label="用到的模型" />
        </div>
      </SectionCard>

      {/* 活跃热力图 */}
      <SectionCard title="活跃热力图 近 20 周">
        <div className="flex flex-col gap-1.5">
          <div className="relative h-[14px]" style={{ width: view.heatCols.length * (heatCell + heatGap) - heatGap }}>
            {view.heatLabels.map((m) => (
              <span key={`${m.col}-${m.text}`} className="absolute top-0 text-10 text-muted" style={{ left: m.col * (heatCell + heatGap) }}>
                {m.text}
              </span>
            ))}
          </div>
          <div className="flex" style={{ gap: heatGap }}>
            {view.heatCols.map((col, ci) => (
              <div key={ci} className="flex flex-col" style={{ gap: heatGap }}>
                {col.map((cell, ri) =>
                  cell.placeholder ? (
                    <div key={ri} style={{ width: heatCell, height: heatCell }} />
                  ) : (
                    <div
                      key={ri}
                      title={`${cell.day} · ${fmtCompact(cell.tokens)} token`}
                      className="rounded-[3px]"
                      style={{
                        width: heatCell,
                        height: heatCell,
                        backgroundColor:
                          cell.level === 0
                            ? 'var(--surface-chip, rgba(0,0,0,0.05))'
                            : `color-mix(in srgb, var(--accent) ${[0.22, 0.42, 0.68, 1][cell.level - 1] * 100}%, var(--surface-chip, rgba(0,0,0,0.05)))`,
                      }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* 30 天堆叠柱 */}
      <SectionCard title="近 30 天每日 token 按模型堆叠">
        <div className="flex gap-2">
          <div className="flex flex-col justify-between py-0 text-right text-10 tabular-nums text-muted" style={{ height: 110 }}>
            <span>{fmtCompact(barMax)}</span>
            <span>{fmtCompact(barMax / 2)}</span>
            <span>0</span>
          </div>
          <div className="flex min-w-0 flex-1 items-end gap-[3px]" style={{ height: 110 }}>
            {view.days.map((d) => {
              const h = Math.round((d.tokens / barMax) * 110);
              const detail = [...d.models.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([m, t]) => `${shortModel(m)} ${fmtCompact(t)}`)
                .join('，');
              return (
                <div
                  key={d.day}
                  className="flex min-w-0 flex-1 flex-col justify-end"
                  style={{ height: 110 }}
                  title={`${d.day} · ${fmtCompact(d.tokens)} token${detail ? `（${detail}）` : ''}`}
                >
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-[2px]"
                    style={{ height: Math.max(h, d.tokens > 0 ? 2 : 0) }}
                  >
                    {[...d.models.entries()].map(([m, t]) => (
                      <div
                        key={m}
                        style={{
                          height: `${d.tokens > 0 ? (t / d.tokens) * 100 : 0}%`,
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
        </div>
      </SectionCard>

      {/* 按 Agent / harness */}
      <SectionCard title="按 Agent / harness 近 30 天">
        <table className="w-full text-12">
          <thead>
            <tr className="border-b border-board text-left text-muted">
              <th className="py-1.5 font-normal">Agent / harness</th>
              <th className="py-1.5 text-right font-normal">近 30 天 token</th>
              <th className="py-1.5 pl-4 font-normal">占比</th>
              <th className="py-1.5 text-right font-normal">今日</th>
              <th className="py-1.5 text-right font-normal">用到的模型</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-board/60">
              <td className="py-2 text-primary">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ backgroundColor: modelColor('pi') }} />
                pi
              </td>
              <td className="py-2 text-right tabular-nums text-primary">{fmtCompact(total30)}</td>
              <td className="py-2 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-24 rounded-full bg-chip">
                    <div className="h-1 rounded-full" style={{ width: '100%', backgroundColor: modelColor('pi') }} />
                  </div>
                  <span className="tabular-nums text-muted">100%</span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums text-secondary">{fmtCompact(view.todayTokens)}</td>
              <td className="py-2 text-right tabular-nums text-secondary">{view.modelCount}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* 按模型 */}
      <SectionCard title="按模型 近 30 天">
        <table className="w-full text-12">
          <thead>
            <tr className="border-b border-board text-left text-muted">
              <th className="py-1.5 font-normal">模型</th>
              <th className="py-1.5 text-right font-normal">总 token</th>
              <th className="py-1.5 pl-4 font-normal">占比</th>
              <th className="py-1.5 text-right font-normal">输入</th>
              <th className="py-1.5 text-right font-normal">输出</th>
              <th className="py-1.5 text-right font-normal">缓存读取</th>
              <th className="py-1.5 text-right font-normal">缓存写入</th>
              <th className="py-1.5 text-right font-normal">缓存命中率</th>
            </tr>
          </thead>
          <tbody>
            {view.models.map((m) => {
              const total = m.input + m.output + m.cacheRead + m.cacheWrite;
              const hit = total > 0 ? m.cacheRead / total : null;
              const pct = total30 > 0 ? m.tokens / total30 : 0;
              return (
                <tr key={m.model} className="border-b border-board/60">
                  <td className="py-2 text-primary">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ backgroundColor: modelColor(m.model) }} />
                    {shortModel(m.model)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-primary">{fmtCompact(m.tokens)}</td>
                  <td className="py-2 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 rounded-full bg-chip">
                        <div className="h-1 rounded-full" style={{ width: `${Math.max(2, pct * 100)}%`, backgroundColor: modelColor(m.model) }} />
                      </div>
                      <span className="tabular-nums text-muted">{(pct * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-secondary">{fmtCompact(m.input)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{fmtCompact(m.output)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{fmtCompact(m.cacheRead)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{fmtCompact(m.cacheWrite)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{hit === null ? '—' : `${(hit * 100).toFixed(1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
