export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 未来的时间点说人话：10 分钟后 / 明天 / 3 周后 */
export function dueLabel(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) return '现在';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} 分钟后`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时后`;

  const days = Math.round(diff / DAY);
  if (days === 1) return '明天';
  if (days < 7) return `${days} 天后`;
  if (days < 30) return `${Math.round(days / 7)} 周后`;
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  return `${(days / 365).toFixed(1)} 年后`;
}

/** 过去的时间点说人话：刚刚 / 3 天前 */
export function pastLabel(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时前`;

  const days = Math.round(diff / DAY);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.round(days / 30)} 个月前`;
  return `${Math.round(days / 365)} 年前`;
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把正文拆成「第一行当标题，其余当内容」 */
export function splitBody(body: string): { title: string; rest: string } {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  const index = trimmed.indexOf('\n');
  if (index === -1) return { title: trimmed, rest: '' };
  return { title: trimmed.slice(0, index).trim(), rest: trimmed.slice(index + 1).trim() };
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 按天分组时的日期标题：今天 / 昨天 / 11 月 5 日 · 周三 */
export function dayGroupLabel(ts: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';

  const d = new Date(ts);
  const week = WEEKDAY[d.getDay()] ?? '';
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week}`;
  }
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}


/** 精确到分钟，给 title 提示用 —— 列表里显示的是「3 天前」这种相对时间 */
export function fullLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
