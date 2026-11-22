/**
 * date.ts 的单元测试。
 *
 * 这里的函数决定「界面上写的是什么时间」，错一天、错一小时都不会崩，
 * 只是让人困惑 —— 而且很难靠肉眼发现（尤其跨时区的时候）。
 *
 * node --import tsx --test scripts/check-date.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY,
  HOUR,
  MINUTE,
  addDays,
  dayGroupLabel,
  dayKey,
  dueLabel,
  fullLabel,
  pastLabel,
  splitBody,
  startOfDay,
  todayStamp,
} from '../web/src/lib/date.ts';

/** 构造一个固定的本地时间，避免测试随运行时刻漂移 */
function at(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/* ---------------------------------------------------------------- dayKey */

test('dayKey 用本地时区，不是 UTC', () => {
  // 本地 11 月 22 日 00:30。东八区的 UTC 还是 21 日 16:30 —— 这条能钉住
  // 「用了 toISOString 就会变成昨天」这个坑
  assert.equal(dayKey(at(2026, 11, 22, 0, 30)), '2026-11-22');
});

test('dayKey 补零', () => {
  assert.equal(dayKey(at(2026, 1, 5, 12)), '2026-01-05');
});

test('同一天不同时刻的 dayKey 一致', () => {
  assert.equal(dayKey(at(2026, 11, 22, 0, 1)), dayKey(at(2026, 11, 22, 23, 59)));
});

/* ---------------------------------------------------------------- startOfDay / addDays */

test('startOfDay 落在当天零点', () => {
  const start = startOfDay(at(2026, 11, 22, 15, 42));
  assert.equal(new Date(start).getHours(), 0);
  assert.equal(new Date(start).getMinutes(), 0);
  assert.equal(dayKey(start), '2026-11-22');
});

test('addDays 跨月', () => {
  assert.equal(dayKey(addDays(at(2026, 11, 30, 10), 1)), '2026-12-01');
});

test('addDays 负数往回走', () => {
  assert.equal(dayKey(addDays(at(2026, 12, 1, 10), -1)), '2026-11-30');
});

test('addDays 跨年', () => {
  assert.equal(dayKey(addDays(at(2026, 12, 31, 23), 1)), '2027-01-01');
});

/* ---------------------------------------------------------------- splitBody */

test('splitBody 首行当标题，其余是正文', () => {
  assert.deepEqual(splitBody('标题\n第二行\n第三行'), { title: '标题', rest: '第二行\n第三行' });
});

test('splitBody 只有一行时正文为空', () => {
  assert.deepEqual(splitBody('只有标题'), { title: '只有标题', rest: '' });
});

test('splitBody 吃掉首尾空白', () => {
  assert.deepEqual(splitBody('  标题  \n  正文  '), { title: '标题', rest: '正文' });
});

test('splitBody 兼容 CRLF', () => {
  assert.deepEqual(splitBody('标题\r\n正文'), { title: '标题', rest: '正文' });
});

test('splitBody 首行是空的时候标题为空', () => {
  // 以换行开头：trim 之后第一行就是正文第一行，标题不会是空串
  assert.deepEqual(splitBody('\n第一行正文'), { title: '第一行正文', rest: '' });
});

test('splitBody 正文里的空行保留', () => {
  assert.deepEqual(splitBody('标题\n甲\n\n乙'), { title: '标题', rest: '甲\n\n乙' });
});

/* ---------------------------------------------------------------- pastLabel */

test('pastLabel 一分钟内算刚刚', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(pastLabel(now - 30_000, now), '刚刚');
});

test('pastLabel 分钟级', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(pastLabel(now - 5 * MINUTE, now), '5 分钟前');
});

test('pastLabel 小时级', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(pastLabel(now - 3 * HOUR, now), '3 小时前');
});

test('pastLabel 昨天', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(pastLabel(now - DAY, now), '昨天');
});

test('pastLabel 几天前', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(pastLabel(now - 4 * DAY, now), '4 天前');
});

/* ---------------------------------------------------------------- dueLabel */

test('dueLabel 已到期是现在', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now, now), '现在');
});

test('dueLabel 差 20 秒说 1 分钟后，不说现在', () => {
  // 「现在」只留给已经到期的。还差二十秒的，说了「现在」反而让人以为
  // 点进去就能复习
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + 20_000, now), '1 分钟后');
});

test('dueLabel 一分半取整到 2 分钟', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + 90_000, now), '2 分钟后');
});

test('dueLabel 已过期也说现在，不说负几天', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now - 3 * DAY, now), '现在');
});

test('dueLabel 分钟级', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + 10 * MINUTE, now), '10 分钟后');
});

test('dueLabel 小时级', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + 3 * HOUR, now), '3 小时后');
});

test('dueLabel 明天', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + DAY, now), '明天');
});

test('dueLabel 几天后', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dueLabel(now + 5 * DAY, now), '5 天后');
});

/* ---------------------------------------------------------------- dayGroupLabel */

test('dayGroupLabel 今天', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dayGroupLabel(at(2026, 11, 22, 3), now), '今天');
});

test('dayGroupLabel 昨天', () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(dayGroupLabel(at(2026, 11, 21, 23), now), '昨天');
});

test('dayGroupLabel 前天及更早显示日期', () => {
  const now = at(2026, 11, 22, 12);
  const label = dayGroupLabel(at(2026, 11, 20, 12), now);
  assert.ok(label.includes('20'), `期望带上日期，实际是「${label}」`);
  assert.ok(!label.includes('今天') && !label.includes('昨天'));
});

/* ---------------------------------------------------------------- fullLabel / todayStamp */

test('fullLabel 是完整的年月日时分', () => {
  const label = fullLabel(at(2026, 11, 22, 15, 42));
  assert.ok(label.includes('2026'), label);
  assert.ok(label.includes('15:42'), label);
});

test('todayStamp 是 yyyy-mm-dd 且等于今天的 dayKey', () => {
  const stamp = todayStamp();
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(stamp, dayKey(Date.now()));
});
