/**
 * 自动化 cron 计算（零依赖纯函数）：下次触发时间。node --test 可直跑。
 * 本地时区语义：weekly=day 0-6（0=周日），monthly=day 1-31，cron=五段（分 时 日 月 周）。
 */

export interface ScheduleRule {
  schedule: 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron';
  time: string | null;
  day: number | null;
  cron: string | null;
}

/** 解析 HH:MM → {h, m}；非法返回 null */
function parseTime(t: string | null | undefined): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return { h, m: mm };
}

/** 五段 cron 求 from 之后的下一次触发；只支持数字与星号与步进 */
function cronNext(expr: string, from: Date): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const parseField = (f: string, min: number, max: number): number[] | null => {
    if (f === '*') return null;
    const out = new Set<number>();
    for (const seg of f.split(',')) {
      const step = /\/(\d+)$/.exec(seg);
      const stepN = step ? Number(step[1]) : 1;
      const base = seg.replace(/\/\d+$/, '');
      if (base === '*') {
        for (let v = min; v <= max; v += stepN) out.add(v);
      } else if (base.includes('-')) {
        const [a, b] = base.split('-').map(Number);
        for (let v = a!; v <= b!; v += stepN) out.add(v);
      } else {
        out.add(Number(base));
      }
    }
    return [...out].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
  };
  const [fMin, fHour, fDom, fMonth, fDow] = parts;
  const mins = parseField(fMin!, 0, 59);
  const hours = parseField(fHour!, 0, 23);
  const doms = parseField(fDom!, 1, 31);
  const months = parseField(fMonth!, 1, 12);
  const dows = parseField(fDow!, 0, 7);
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const min = cursor.getMinutes();
    const hour = cursor.getHours();
    const dom = cursor.getDate();
    const month = cursor.getMonth() + 1;
    const dow = cursor.getDay();
    const domHit = doms === null || doms.includes(dom);
    const dowHit = dows === null || dows.includes(dow) || (dows.includes(7) && dow === 0);
    const dayHit = doms === null || dows === null ? domHit && dowHit : domHit || dowHit;
    const hit =
      (mins === null || mins.includes(min)) &&
      (hours === null || hours.includes(hour)) &&
      (months === null || months.includes(month)) &&
      dayHit;
    if (hit) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/** 计算下次触发（ms epoch；严格大于 from）。输入是本地化规则。 */
export function nextRunAt(rule: ScheduleRule, from: Date = new Date()): number | null {
  const nextDay = (d: Date, addDays: number): Date => {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + addDays);
    return x;
  };
  switch (rule.schedule) {
    case 'hourly': {
      const x = new Date(from.getTime());
      x.setMinutes(0, 0, 0);
      x.setHours(x.getHours() + 1);
      return x.getTime();
    }
    case 'daily': {
      const t = parseTime(rule.time);
      if (!t) return null;
      let x = new Date(from.getTime());
      x.setHours(t.h, t.m, 0, 0);
      if (x.getTime() <= from.getTime()) x = nextDay(x, 1);
      return x.getTime();
    }
    case 'weekdays': {
      const t = parseTime(rule.time);
      if (!t) return null;
      for (let i = 0; i < 8; i++) {
        const x = new Date(from.getTime());
        x.setHours(t.h, t.m, 0, 0);
        const cand = nextDay(x, i);
        const dow = cand.getDay();
        if (cand.getTime() > from.getTime() && dow >= 1 && dow <= 5) return cand.getTime();
      }
      return null;
    }
    case 'weekly': {
      const t = parseTime(rule.time);
      const target = rule.day ?? 0;
      if (!t) return null;
      for (let i = 0; i < 8; i++) {
        const x = new Date(from.getTime());
        x.setHours(t.h, t.m, 0, 0);
        const cand = nextDay(x, i);
        if (cand.getTime() > from.getTime() && cand.getDay() === target) return cand.getTime();
      }
      return null;
    }
    case 'monthly': {
      const t = parseTime(rule.time);
      const dom = rule.day ?? 1;
      if (!t || dom < 1 || dom > 31) return null;
      for (let mo = 0; mo < 14; mo++) {
        const x = new Date(from.getFullYear(), from.getMonth() + mo, dom, t.h, t.m, 0, 0);
        if (x.getDate() !== dom) continue;
        if (x.getTime() > from.getTime()) return x.getTime();
      }
      return null;
    }
    case 'cron':
      return rule.cron ? cronNext(rule.cron, from) : null;
    default:
      return null;
  }
}
