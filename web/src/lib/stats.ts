import { addDays, dayKey, startOfDay } from './date';
import type { Note } from '../types';

export function computeStreak(log: Record<string, number>, now = Date.now()): number {
  let cursor = startOfDay(now);
  if (!log[dayKey(cursor)]) cursor = addDays(cursor, -1);

  let streak = 0;
  while (log[dayKey(cursor)]) {
    streak += 1;
    cursor = addDays(cursor, -1);
    if (streak > 3650) break;
  }
  return streak;
}

export interface HeatCell {
  ts: number;
  count: number;
  future: boolean;
}

export function buildHeatmap(log: Record<string, number>, weeks = 12, now = Date.now()): HeatCell[] {
  const today = startOfDay(now);
  const start = addDays(today, -(weeks * 7 - 1));
  const offset = (new Date(start).getDay() + 6) % 7;
  const gridStart = addDays(start, -offset);

  const cells: HeatCell[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const ts = addDays(gridStart, index);
    cells.push({ ts, count: log[dayKey(ts)] ?? 0, future: ts > today });
  }
  return cells;
}

export function totalReviews(log: Record<string, number>): number {
  return Object.values(log).reduce((sum, value) => sum + value, 0);
}

export function countBy<K extends string>(items: Note[], key: (note: Note) => K): Record<K, number> {
  const result = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}


/**
 * 最近 7 天复习了几次（含今天）。
 *
 * 「累计 340 次」这种数字看不出最近的状态 —— 这周是天天在看，还是三周没
 * 打开过，只有按周算才看得出来。
 */
export function weekReviews(log: Record<string, number>, now = Date.now()): number {
  let total = 0;
  let cursor = startOfDay(now);
  for (let i = 0; i < 7; i += 1) {
    total += log[dayKey(cursor)] ?? 0;
    cursor = addDays(cursor, -1);
  }
  return total;
}
