export const DAY = 86_400_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 本地时区的 yyyy-mm-dd，用来按天聚合 */
export function dayKey(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 把时间差说成人话（往后看）：「10 分钟后」「明天」「23 天后」 */
export function humanDelta(ms: number): string {
  if (ms <= 0) return '现在';
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} 分钟后`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} 小时后`;
  const days = Math.round(ms / DAY);
  if (days <= 1) return '明天';
  if (days < 30) return `${days} 天后`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月后`;
  return `${Math.round(months / 12)} 年后`;
}

/** 往回看：「刚刚」「3 天前」 */
export function humanAgo(ms: number): string {
  if (ms < MINUTE) return '刚刚';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} 分钟前`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} 小时前`;
  const days = Math.round(ms / DAY);
  if (days <= 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.round(months / 12)} 年前`;
}

/** 距离某个时间点还有多久（用于列表里的「下次」标签） */
export function dueLabel(due: number, now: number): string {
  const diff = due - now;
  if (diff <= 0) {
    const overdue = Math.round(-diff / DAY);
    return overdue >= 1 ? `逾期 ${overdue} 天` : '该回顾了';
  }
  return humanDelta(diff);
}
