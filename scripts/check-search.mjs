/**
 * search.ts 的单元测试。
 *
 * 搜索决定「哪些笔记被找出来、排第几」。它不崩，但排错了人就会觉得
 * 「这应用找不到我的东西」——比崩了还难解释。
 *
 * node --import tsx --test scripts/check-search.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY } from '../web/src/lib/date.ts';
import { relatedNotes, searchNotes, snippet, tokenize } from '../web/src/lib/search.ts';

const NOW = new Date(2026, 10, 22, 12, 0, 0, 0).getTime();

function note(id, body, agoDays = 1) {
  const created = NOW - agoDays * DAY;
  return {
    id,
    body,
    createdAt: created,
    updatedAt: created,
    deletedAt: null,
    memory: { due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0, lastReviewedAt: null, lastGrade: null },
    reviewCount: 1,
    baseUpdatedAt: created,
  };
}

/* ---------------------------------------------------------------- tokenize */

test('中文按两个字一组切', () => {
  assert.deepEqual(tokenize('以太网'), ['以太', '太网']);
});

test('单个汉字原样保留', () => {
  assert.deepEqual(tokenize('网'), ['网']);
});

test('英文单词整个保留', () => {
  assert.deepEqual(tokenize('probe'), ['probe']);
});

test('带下划线和横线的标识符不被切碎', () => {
  assert.deepEqual(tokenize('EPROBE_DEFER'), ['eprobe_defer']);
});

test('大小写归一', () => {
  assert.deepEqual(tokenize('Probe'), tokenize('probe'));
});

test('中英混排各自处理', () => {
  assert.deepEqual(tokenize('probe 慢'), ['probe', '慢']);
});

test('空串和纯标点什么都不产出', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('—— …'), []);
});

/* ---------------------------------------------------------------- searchNotes */

const library = [
  note('a', 'probe 慢，先怀疑 regulator 的上电时序，最后才怀疑内核。', 1),
  note('b', '看到 -517 就是 EPROBE_DEFER，不是失败。', 3),
  note('c', '以太网 phy 自协商失败，先换网线再换交换机。', 5),
  note('d', '间隔重复的关键不是复习，是在「快忘记」的那一刻复习。', 10),
];

test('空查询返回空结果', () => {
  const result = searchNotes(library, '   ');
  assert.equal(result.hits.length, 0);
  assert.deepEqual(result.marks, []);
});

test('英文关键词能找到和排前面', () => {
  const result = searchNotes(library, 'probe', NOW);
  assert.ok(result.hits.length >= 1, '至少命中一条');
  assert.equal(result.hits[0].note.id, 'a', '标题命中排第一');
});

test('中文查询能找到', () => {
  const result = searchNotes(library, '以太网', NOW);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].note.id, 'c');
});

test('拼音首字母能找到中文笔记', () => {
  const result = searchNotes(library, 'ytw', NOW);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].note.id, 'c');
  assert.equal(result.usedPinyin, true);
});

test('符号查询（-517）走字面包含也能找到', () => {
  const result = searchNotes(library, '-517', NOW);
  assert.ok(result.hits.some((hit) => hit.note.id === 'b'), '应该命中 -517 那条');
});

test('找不到时返回空而没抛错', () => {
  const result = searchNotes(library, 'zzzzqqq', NOW);
  assert.equal(result.hits.length, 0);
});

test('删掉的笔记不出现在结果里', () => {
  const withDeleted = [...library, { ...note('x', 'probe 已删除的一条', 2), deletedAt: NOW }];
  const result = searchNotes(withDeleted, 'probe', NOW);
  assert.ok(!result.hits.some((hit) => hit.note.id === 'x'));
});

test('多个词是 OR：各命中一个词的两条都在结果里', () => {
  // 「probe」在 a 里、「以太网」在 c 里 —— 两条都该出现，靠覆盖率分先后
  const result = searchNotes(library, 'probe 以太网', NOW);
  const ids = result.hits.map((hit) => hit.note.id);
  assert.ok(ids.includes('a'), '含 probe 的要在');
  assert.ok(ids.includes('c'), '含 以太网 的要在');
  assert.ok(result.hits.every((hit) => hit.coverage > 0 && hit.coverage <= 1));
});

test('两个词都命中的排在一个词命中的前面', () => {
  const both = note('both', 'probe 和 以太网 都在这条里。', 2);
  const result = searchNotes([...library, both], 'probe 以太网', NOW);
  assert.equal(result.hits[0].note.id, 'both');
  assert.equal(result.hits[0].coverage, 1);
});

test('命中率高的排前面', () => {
  const result = searchNotes(library, '复习', NOW);
  assert.ok(result.hits.length >= 1);
  assert.equal(result.hits[0].note.id, 'd');
});

test('marks 里带着实际参与高亮的词', () => {
  const result = searchNotes(library, 'regulator', NOW);
  assert.ok(result.marks.length >= 1);
  assert.ok(result.marks.some((mark) => mark.toLowerCase().includes('regulator')));
});

test('结果里带着相关度分数', () => {
  const result = searchNotes(library, 'probe', NOW);
  assert.equal(typeof result.hits[0].score, 'number');
  assert.ok(result.hits[0].score > 0);
});

/* ---------------------------------------------------------------- relatedNotes */

test('讲得相近的：撞三个词才推', () => {
  const target = note('t', 'regulator 上电时序不够，导致 probe 一直 defer，最后超时。', 1);
  const close = note('c1', 'probe 慢的时候先量 regulator 上电时序，大多数是时序不够。', 2);
  const far = note('f1', '今天中午吃了面条。', 3);

  const related = relatedNotes(target, [target, close, far]);
  assert.equal(related.length, 1);
  assert.equal(related[0].note.id, 'c1');
});

test('讲得相近的：不推自己', () => {
  const target = note('t', 'regulator 上电时序不够导致 probe 超时。', 1);
  const related = relatedNotes(target, [target]);
  assert.equal(related.length, 0);
});

test('讲得相近的：完全不沾边时返回空', () => {
  const target = note('t', 'regulator 上电时序不够。', 1);
  const other = note('o', '以太网 phy 自协商。', 2);
  assert.equal(relatedNotes(target, [target, other]).length, 0);
});

test('讲得相近的：结果数不超过 limit', () => {
  const target = note('t', 'regulator 上电时序 probe 内核 调度 频率', 1);
  /*
   * 这里只能断言「不超过」，不能断言「恰好 2 条」。
   *
   * 想让 5 条都稳定被推，它们就得都含 target 的关键词；可一旦每个词都在
   * 五条里出现，算法就会把它们当「太常见的词」过滤掉（正是它该做的），
   * 候选池反而空了。没有第三种状态 —— 要么五条全像（全被过滤），要么
   * 只有少数几条像（凑不满 limit）。
   */
  const others = [1, 2, 3, 4, 5].map((i) =>
    note(`o${i}`, `regulator 上电时序 probe 内核 调度 频率，第 ${i} 条`, i + 2),
  );
  const related = relatedNotes(target, [target, ...others], 2);
  assert.ok(related.length <= 2, `实际 ${related.length} 条，超过了 limit`);
});

/* ---------------------------------------------------------------- snippet */

test('短文本原样返回', () => {
  assert.equal(snippet('短句子', []), '短句子');
});

test('长文本被截断并加省略号', () => {
  const long = '甲'.repeat(200);
  const out = snippet(long, [], 20);
  assert.ok(out.length <= 24, `实际长度 ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('有命中词时从命中处附近开始截', () => {
  const text = `${'铺垫'.repeat(40)} regulator ${'尾巴'.repeat(40)}`;
  const out = snippet(text, ['regulator'], 20);
  assert.ok(out.includes('regulator'), `实际是「${out}」`);
  assert.ok(out.startsWith('…'), '前面有省略号说明是从中间截的');
});

test('命中词在开头时不加前省略号', () => {
  const text = `regulator ${'尾巴'.repeat(60)}`;
  const out = snippet(text, ['regulator'], 20);
  assert.ok(!out.startsWith('…'));
});
