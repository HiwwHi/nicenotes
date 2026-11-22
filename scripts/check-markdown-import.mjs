/**
 * markdown-import.ts 的单元测试。
 *
 * 这是数据入口。解析错了不会报错，只会把一份文件拆成错误条数的笔记，
 * 然后用户按了「导入」，原始文件还不一定留着。
 *
 * node --import tsx --test scripts/check-markdown-import.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contentHash,
  parseMarkdownFile,
  toBody,
} from '../web/src/lib/markdown-import.ts';

/* ---------------------------------------------------------------- 单条 */

test('没有标题行的文件用文件名当标题，正文整段保留', () => {
  const notes = parseMarkdownFile('排查记录.md', '第一行不是标题\n第二行');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '排查记录');
  assert.ok(notes[0].body.includes('第一行不是标题'));
});

test('文件名去掉扩展名，大小写都认', () => {
  assert.equal(parseMarkdownFile('abc.MD', '正文').at(0).title, 'abc');
  assert.equal(parseMarkdownFile('abc.markdown', '正文').at(0).title, 'abc');
  assert.equal(parseMarkdownFile('abc.txt', '正文').at(0).title, 'abc');
});

test('## 开头的第一行当标题', () => {
  const notes = parseMarkdownFile('x.md', '## 我的标题\n正文内容');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '我的标题');
  assert.equal(notes[0].body, '正文内容');
});

test('# 一级标题也认', () => {
  const notes = parseMarkdownFile('x.md', '# 一级\n内容');
  assert.equal(notes[0].title, '一级');
});

test('标题两侧的空白被吃掉', () => {
  const notes = parseMarkdownFile('x.md', '##   两边有空格   \n内容');
  assert.equal(notes[0].title, '两边有空格');
});

/* ---------------------------------------------------------------- 多节 */

test('多个 ## 拆成多条', () => {
  const notes = parseMarkdownFile('x.md', '## 一\n甲\n## 二\n乙\n## 三\n丙');
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => n.title), ['一', '二', '三']);
  assert.deepEqual(notes.map((n) => n.body), ['甲', '乙', '丙']);
});

test('第一个 ## 之前的内容如果非空，单独成为一条', () => {
  const notes = parseMarkdownFile('lead.md', '开头的说明\n\n## 一\n甲');
  assert.equal(notes.length, 2);
  assert.equal(notes[0].body.includes('开头的说明'), true);
  assert.equal(notes[1].title, '一');
});

test('第一个 ## 之前只有空白时不单独成条', () => {
  const notes = parseMarkdownFile('lead.md', '\n\n   \n## 一\n甲');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '一');
});

test('代码块里的 ## 不当分割', () => {
  const text = ['## 一', '```bash', '## 这在代码块里', '```', '正文'].join('\n');
  const notes = parseMarkdownFile('x.md', text);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].body.includes('## 这在代码块里'));
});

test('三个反引号成对开关，不会一直关在里面', () => {
  const text = [
    '## 一',
    '```',
    'code',
    '```',
    '## 二',
    '乙',
  ].join('\n');
  const notes = parseMarkdownFile('x.md', text);
  assert.equal(notes.length, 2);
});

/* ---------------------------------------------------------------- 边界 */

test('空文件返回空数组', () => {
  assert.deepEqual(parseMarkdownFile('x.md', ''), []);
  assert.deepEqual(parseMarkdownFile('x.md', '   \n\n  '), []);
});

test('只有标题没有正文的那条会被丢掉', () => {
  // 文件开头的一级标题下面常常没内容，那是文件名不是笔记
  const notes = parseMarkdownFile('x.md', '# 文件标题');
  assert.equal(notes.length, 1, '全空的话至少保留一条，别丢光');
  assert.equal(notes[0].title, '文件标题');
});

test('CRLF 换行也能正确拆', () => {
  const notes = parseMarkdownFile('x.md', '## 一\r\n甲\r\n## 二\r\n乙');
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => n.title), ['一', '二']);
});

test('正文里的空行保留', () => {
  const notes = parseMarkdownFile('x.md', '## 一\n甲\n\n乙');
  assert.equal(notes[0].body, '甲\n\n乙');
});

test('标题里的 markdown 行内标记原样保留在 title 里', () => {
  const notes = parseMarkdownFile('x.md', '## 用 `make` 编译\n正文');
  assert.ok(notes[0].title.includes('`make`'));
});

/* ---------------------------------------------------------------- toBody */

test('toBody 把标题和正文拼回去', () => {
  assert.equal(toBody({ title: '标题', body: '正文' }), '标题\n正文');
});

test('toBody 正文为空时只有标题', () => {
  assert.equal(toBody({ title: '标题', body: '' }), '标题');
});

/* ---------------------------------------------------------------- contentHash */

test('contentHash 对同样内容稳定', () => {
  assert.equal(contentHash('同样的内容'), contentHash('同样的内容'));
});

test('contentHash 对空白差异不敏感（导入判重靠它）', () => {
  assert.equal(contentHash('甲\n乙'), contentHash('  甲\n乙  '));
  assert.equal(contentHash('甲\r\n乙'), contentHash('甲\n乙'));
});

test('contentHash 对实际内容差异敏感', () => {
  assert.notEqual(contentHash('甲\n乙'), contentHash('甲\n丙'));
});

test('contentHash 是短字符串', () => {
  const hash = contentHash('随便一段比较长的内容'.repeat(20));
  assert.ok(hash.length <= 16, `实际长度 ${hash.length}`);
});
