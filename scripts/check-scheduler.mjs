/**
 * scheduler.ts 的单元测试。
 *
 * 排期是「间隔重复」这件事的核心。它算错了不会崩，只会让笔记在以年为
 * 单位的尺度上要么被过度打扰、要么永远不再出现 —— 而这两种错，人几乎
 * 察觉不到。
 *
 * node --import tsx --test scripts/check-scheduler.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, HOUR, MINUTE } from '../web/src/lib/date.ts';
import {
  applyGrade,
  freshMemory,
  isDue,
  isNew,
  nextDue,
} from '../web/src/lib/scheduler.ts';

const NOW = new Date(2026, 10, 22, 12, 0, 0, 0).getTime();

/** 造一个复习过若干次的 memory */
function mem(overrides = {}) {
  return { ...freshMemory(NOW), ...overrides };
}

/* ---------------------------------------------------------------- freshMemory */

test('新笔记立刻到期，reps 和 interval 都是 0', () => {
  const memory = freshMemory(NOW);
  assert.equal(memory.due, NOW);
  assert.equal(memory.interval, 0);
  assert.equal(memory.reps, 0);
  assert.equal(memory.ease, 2.5);
  assert.equal(memory.lapses, 0);
  assert.equal(memory.lastReviewedAt, null);
});

/* ---------------------------------------------------------------- 三条主路径 */

test('第一次「记得」给 2 天', () => {
  const due = nextDue(mem(), 2, NOW);
  assert.equal(Math.round((due - NOW) / DAY), 2);
});

test('第二次「记得」给 5 天', () => {
  const memory = mem({ reps: 1, interval: 2, ease: 2.58 });
  const due = nextDue(memory, 2, NOW);
  assert.equal(Math.round((due - NOW) / DAY), 5);
});

test('第三次「记得」按 ease 拉开', () => {
  const memory = mem({ reps: 2, interval: 5, ease: 2.66 });
  const due = nextDue(memory, 2, NOW);
  const days = Math.round((due - NOW) / DAY);
  // max(interval + 2, interval * 新 ease) = max(7, 5 × 2.74) → 14
  assert.equal(days, 14);
});

test('「有点模糊」比「记得」短', () => {
  const base = mem({ reps: 2, interval: 10, ease: 2.5 });
  const fuzzy = nextDue(base, 1, NOW);
  const good = nextDue(base, 2, NOW);
  assert.ok(fuzzy < good, `模糊 ${fuzzy} 应该早于记得 ${good}`);
});

test('「忘了」十分钟后就回来', () => {
  const memory = mem({ reps: 3, interval: 20, ease: 2.5 });
  const due = nextDue(memory, 0, NOW);
  assert.equal(due - NOW, 10 * MINUTE);
});

/* ---------------------------------------------------------------- 忘了不清零历史 */

test('「忘了」把 reps 归零但不清掉 lapses 计数', () => {
  const before = mem({ reps: 4, interval: 30, ease: 2.5, lapses: 2 });
  const note = { memory: before };
  const after = applyGrade(note, 0, NOW).memory;

  assert.equal(after.reps, 0);
  assert.equal(after.interval, 0);
  assert.equal(after.lapses, 3);
});

test('「忘了」压低 ease，但不低于下限 1.3', () => {
  let memory = mem({ reps: 5, interval: 40, ease: 1.4 });
  for (let i = 0; i < 5; i += 1) {
    const note = { memory };
    memory = applyGrade(note, 0, NOW).memory;
  }
  assert.equal(memory.ease, 1.3);
});

test('忘了之后再记得，间隔从 2 天重新开始而不是从原来那个大数', () => {
  // 这是「不清零历史」的边界：忘了之后 reps 归零，下一次「记得」应该
  // 走「第一次」的分支，而不是接着 40 天往上翻
  const memory = mem({ reps: 0, interval: 0, ease: 2.3, lapses: 1 });
  const due = nextDue(memory, 2, NOW);
  assert.equal(Math.round((due - NOW) / DAY), 2);
});

/* ---------------------------------------------------------------- 上下界 */

test('ease 不会超过 3.2', () => {
  let memory = mem({ reps: 10, interval: 100, ease: 3.15 });
  for (let i = 0; i < 10; i += 1) {
    const note = { memory };
    memory = applyGrade(note, 2, NOW).memory;
  }
  assert.equal(memory.ease, 3.2);
});

test('间隔不超过 365 天', () => {
  const memory = mem({ reps: 10, interval: 300, ease: 3.2 });
  const due = nextDue(memory, 2, NOW);
  assert.ok(due - NOW <= 365 * DAY, `实际 ${(due - NOW) / DAY} 天`);
});

test('间隔至少 1 天（除了「忘了」的十分钟）', () => {
  const memory = mem({ reps: 1, interval: 0, ease: 2.5 });
  const due = nextDue(memory, 1, NOW);
  assert.ok(due - NOW >= DAY);
});

/* ---------------------------------------------------------------- isDue / isNew */

test('没复习过的是新笔记', () => {
  // 判据是 reviewCount 而不是 memory.reps —— 「看过但忘了」reps 也归零，
  // 但那不是新笔记
  assert.equal(isNew({ memory: freshMemory(NOW), reviewCount: 0 }), true);
});

test('复习过的不算新', () => {
  assert.equal(isNew({ memory: mem({ reps: 1, lastReviewedAt: NOW }), reviewCount: 1 }), false);
});

test('忘了之后 reps 归零，但不再是新笔记', () => {
  const memory = mem({ reps: 0, lastReviewedAt: NOW, lapses: 1 });
  assert.equal(isNew({ memory, reviewCount: 5 }), false);
});

test('到期了算 due', () => {
  assert.equal(isDue({ memory: mem({ due: NOW - 1000 }), reviewCount: 2 }, NOW), true);
});

test('差一秒没到的不算 due', () => {
  assert.equal(isDue({ memory: mem({ due: NOW + 1000 }), reviewCount: 2 }, NOW), false);
});

test('刚好到点算 due', () => {
  assert.equal(isDue({ memory: mem({ due: NOW }), reviewCount: 2 }, NOW), true);
});

/* ---------------------------------------------------------------- applyGrade 的其他字段 */

test('applyGrade 记下 lastReviewedAt 和 lastGrade', () => {
  const note = { memory: freshMemory(NOW), reviewCount: 0 };
  const after = applyGrade(note, 2, NOW);
  assert.equal(after.memory.lastReviewedAt, NOW);
  assert.equal(after.memory.lastGrade, 2);
});

test('连续三次「记得」间隔单调增长', () => {
  let memory = freshMemory(NOW);
  const days = [];
  for (let i = 0; i < 3; i += 1) {
    const note = { memory };
    const after = applyGrade(note, 2, NOW);
    memory = after.memory;
    days.push(memory.interval);
  }
  assert.deepEqual(days, [2, 5, 14]);
});

test('长时间「记得」之后一次「忘了」，间隔回到十分钟', () => {
  const memory = mem({ reps: 8, interval: 200, ease: 3.0 });
  const due = nextDue(memory, 0, NOW);
  assert.equal(due - NOW, 10 * MINUTE);
});
