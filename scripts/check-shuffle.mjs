/**
 * shuffle.ts 的单元测试。
 *
 * 它决定「随手翻到」推哪条。算法错了不会崩，但可能总是推同几条 ——
 * 而且因为它刻意做成「同一个 seed 一定得同一个顺序」，这种偏向会稳定
 * 复现，人只会觉得「怎么老是这条」。
 *
 * node --import tsx --test scripts/check-shuffle.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { shuffle } from '../web/src/lib/shuffle.ts';

const items = Array.from({ length: 10 }, (_, i) => `n${i}`);

test('同一个 seed 得到同一个顺序', () => {
  assert.deepEqual(shuffle(items, 42), shuffle(items, 42));
});

test('不同 seed 得到不同顺序', () => {
  const a = shuffle(items, 1).join(',');
  const b = shuffle(items, 2).join(',');
  assert.notEqual(a, b);
});

test('元素一个不多一个不少', () => {
  const out = shuffle(items, 7);
  assert.equal(out.length, items.length);
  assert.deepEqual([...out].sort(), [...items].sort());
});

test('不改原数组', () => {
  const source = [...items];
  shuffle(source, 3);
  assert.deepEqual(source, items);
});

test('空数组返回空数组', () => {
  assert.deepEqual(shuffle([], 5), []);
});

test('单元素保持原样', () => {
  assert.deepEqual(shuffle(['only'], 5), ['only']);
});

test('两个元素两种顺序都能出现', () => {
  const seen = new Set();
  for (let seed = 1; seed < 40; seed += 1) {
    seen.add(shuffle(['a', 'b'], seed).join(''));
  }
  assert.ok(seen.has('ab') && seen.has('ba'), `只出现了 ${[...seen].join('/')}`);
});

test('seed 为 0 也能用（内部转成 1，不卡死）', () => {
  const out = shuffle(items, 0);
  assert.equal(out.length, items.length);
  assert.notEqual(out.join(','), items.join(','));
});

test('负数 seed 不抛错且结果稳定', () => {
  const a = shuffle(items, -123);
  const b = shuffle(items, -123);
  assert.deepEqual(a, b);
  assert.equal(a.length, items.length);
});

test('分布大致均匀：第一位不该总是同一条', () => {
  /*
   * 1000 个不同的 seed，看每个元素出现在第一位的次数。
   *
   * 完美均匀是每个 100 次。这里只要求落在 40–170 之间 —— 太严会因为
   * 伪随机的波动偶发失败（测试偶发失败比没测试更糟），太松又发现不了
   * 真正的偏向（比如 next() 有偏置、或者 j 的范围算错）。
   */
  const counts = new Map(items.map((item) => [item, 0]));
  for (let seed = 1; seed <= 1000; seed += 1) {
    const first = shuffle(items, seed)[0];
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }

  for (const [item, count] of counts) {
    assert.ok(count >= 40 && count <= 170, `${item} 出现在首位 ${count} 次，偏离太远`);
  }

  // 每个元素都至少当过几次第一 —— 不该有元素永远轮不到
  const never = [...counts].filter(([, count]) => count === 0).map(([item]) => item);
  assert.deepEqual(never, [], `这些元素从来没排到过第一位：${never.join(',')}`);
});
