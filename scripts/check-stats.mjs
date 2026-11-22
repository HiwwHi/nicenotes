/**
 * stats.ts 的单元测试。
 *
 * 「连续 N 天」这类数字，错一天不会报错，只会让人怀疑自己 —— 明明昨天
 * 复习了，怎么断了。
 *
 * node --import tsx --test scripts/check-stats.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, dayKey, startOfDay } from '../web/src/lib/date.ts';
import {
  buildHeatmap,
  computeStreak,
  countBy,
  longestStreak,
  totalReviews,
  weekReviews,
} from '../web/src/lib/stats.ts';

const NOW = new Date(2026, 10, 22, 14, 30, 0, 0).getTime();

/** 相对今天偏移 n 天的日期键 */
const key = (offset) => dayKey(addDays(startOfDay(NOW), offset));

/* ---------------------------------------------------------------- computeStreak */

test('今天复习了，连续 1 天', () => {
  assert.equal(computeStreak({ [key(0)]: 3 }, NOW), 1);
});

test('今天和昨天都有，连续 2 天', () => {
  assert.equal(computeStreak({ [key(0)]: 1, [key(-1)]: 2 }, NOW), 2);
});

test('今天还没开始，昨天的连续不算断', () => {
  // 这是最容易写错的一处：下午三点还没复习，不该把昨天开始的那串归零
  assert.equal(computeStreak({ [key(-1)]: 1, [key(-2)]: 1, [key(-3)]: 1 }, NOW), 3);
});

test('中间断了一天就从头数', () => {
  const log = { [key(0)]: 1, [key(-1)]: 1, [key(-3)]: 1, [key(-4)]: 1 };
  assert.equal(computeStreak(log, NOW), 2);
});

test('完全没有记录是 0', () => {
  assert.equal(computeStreak({}, NOW), 0);
});

test('只有很久以前有记录，连续是 0', () => {
  assert.equal(computeStreak({ [key(-10)]: 1 }, NOW), 0);
});

test('记录里是 0 次等同于那天没打开', () => {
  // 今天记了 0 次，和今天还没打开是一回事：从昨天开始数，连续 1 天。
  // 不能因为「有这一行的 key」就把今天算进去。
  assert.equal(computeStreak({ [key(0)]: 0, [key(-1)]: 1 }, NOW), 1);
  assert.equal(computeStreak({ [key(0)]: 0 }, NOW), 0);
});

/* ---------------------------------------------------------------- buildHeatmap */

test('热力图的格子数是周数 ×7', () => {
  assert.equal(buildHeatmap({}, 12, NOW).length, 84);
  assert.equal(buildHeatmap({}, 4, NOW).length, 28);
});

test('热力图的最后一格是今天', () => {
  const cells = buildHeatmap({}, 12, NOW);
  assert.equal(dayKey(cells[cells.length - 1].ts), dayKey(NOW));
});

test('热力图按日期升序排列', () => {
  const cells = buildHeatmap({}, 4, NOW);
  for (let i = 1; i < cells.length; i += 1) {
    assert.ok(cells[i].ts > cells[i - 1].ts, `第 ${i} 格乱序`);
  }
});

test('热力图把次数填进对应的格子', () => {
  const cells = buildHeatmap({ [key(-3)]: 7 }, 4, NOW);
  const hit = cells.find((cell) => dayKey(cell.ts) === key(-3));
  assert.equal(hit.count, 7);
  assert.equal(hit.future, false);
});

test('没有记录的日子是 0 次，不是 undefined', () => {
  const cells = buildHeatmap({}, 2, NOW);
  assert.ok(cells.every((cell) => cell.count === 0));
});

test('热力图里没有未来的格子（最后一格就是今天）', () => {
  const cells = buildHeatmap({}, 12, NOW);
  assert.equal(cells.filter((cell) => cell.future).length, 0);
});

test('热力图从周一开头对齐', () => {
  const cells = buildHeatmap({}, 12, NOW);
  // 第 0 格应该是周一（getDay 为 1）
  assert.equal(new Date(cells[0].ts).getDay(), 1);
});

/* ---------------------------------------------------------------- totalReviews */

test('累计复习是各天之和', () => {
  assert.equal(totalReviews({ [key(0)]: 3, [key(-1)]: 2 }), 5);
});

test('空记录是 0', () => {
  assert.equal(totalReviews({}), 0);
});

/* ---------------------------------------------------------------- weekReviews */

test('本周包含今天和往前六天', () => {
  const log = { [key(0)]: 3, [key(-1)]: 2, [key(-6)]: 1, [key(-7)]: 9 };
  assert.equal(weekReviews(log, NOW), 6);
});

test('本周不含七天前的那天', () => {
  assert.equal(weekReviews({ [key(-7)]: 5 }, NOW), 0);
});

test('本周为空时是 0', () => {
  assert.equal(weekReviews({}, NOW), 0);
});

/* ---------------------------------------------------------------- countBy */

test('countBy 按给定维度计数', () => {
  const notes = [
    { archivedAt: null },
    { archivedAt: 123 },
    { archivedAt: null },
  ];
  const result = countBy(notes, (note) => (note.archivedAt ? 'archived' : 'live'));
  assert.deepEqual(result, { live: 2, archived: 1 });
});

test('countBy 空数组返回空对象', () => {
  assert.deepEqual(countBy([], () => 'x'), {});
});

/* ---------------------------------------------------------------- longestStreak */

test('最长连续：空记录是 0', () => {
  assert.equal(longestStreak({}), 0);
});

test('最长连续：只有一天是 1', () => {
  assert.equal(longestStreak({ [key(-5)]: 1 }), 1);
});

test('最长连续：连着三天就是 3', () => {
  assert.equal(longestStreak({ [key(-2)]: 1, [key(-3)]: 1, [key(-4)]: 1 }), 3);
});

test('最长连续：取最长的那一段，不是最后一段', () => {
  // 十天前连续 5 天，今天单独一天 —— 最好成绩是 5，不是 1
  const log = { [key(0)]: 2 };
  for (let i = 10; i >= 6; i -= 1) log[key(i)] = 1;
  assert.equal(longestStreak(log), 5);
  assert.equal(computeStreak(log, NOW), 1);
});

test('最长连续：值为 0 的日子不算进连续', () => {
  assert.equal(longestStreak({ [key(-1)]: 1, [key(-2)]: 0, [key(-3)]: 1 }), 1);
});

test('最长连续：跨月跨年也算连续', () => {
  const dec31 = '2025-12-31';
  const jan1 = '2026-01-01';
  assert.equal(longestStreak({ [dec31]: 1, [jan1]: 1 }), 2);
});
