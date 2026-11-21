/**
 * rich.ts 的单元测试。
 *
 * 这一层是「屏幕上长什么样」和「导出的 HTML 长什么样」的共同源头，
 * 改了切分规则，两边会一起错，所以值得钉住。
 *
 * 不需要浏览器、不需要数据库：node --import tsx --test scripts/check-rich.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bodyToHtml, escapeHtml, parseRich, plainText, splitLinks } from '../web/src/lib/rich.ts';

/* ---------------------------------------------------------------- 行内标记 */

test('纯文本原样成为一个 text 段', () => {
  assert.deepEqual(parseRich('hello'), [{ kind: 'text', text: 'hello' }]);
});

test('行内代码切成 text / inline / text 三段', () => {
  assert.deepEqual(parseRich('a `code` b'), [
    { kind: 'text', text: 'a ' },
    { kind: 'inline', text: 'code' },
    { kind: 'text', text: ' b' },
  ]);
});

test('[[标题]] 变成 wiki 段，首尾空白去掉', () => {
  assert.deepEqual(parseRich('看 [[ 目标笔记 ]] 这条'), [
    { kind: 'text', text: '看 ' },
    { kind: 'wiki', text: '目标笔记' },
    { kind: 'text', text: ' 这条' },
  ]);
});

test('空的 [[]] 原样留着，不吞掉用户写的东西', () => {
  assert.deepEqual(parseRich('[[   ]]'), [{ kind: 'text', text: '[[   ]]' }]);
});

/* ------------------------------------------------------------------ 代码块 */

test('围栏代码块带语言标记', () => {
  assert.deepEqual(parseRich('```js\nconst a = 1;\n```'), [
    { kind: 'block', text: 'const a = 1;', lang: 'js' },
  ]);
});

test('没闭合的围栏当成代码块一直延续到文末', () => {
  assert.deepEqual(parseRich('```js\nconst a = 1;'), [
    { kind: 'block', text: 'const a = 1;', lang: 'js' },
  ]);
});

test('代码块结束后的文字还是普通段落', () => {
  assert.deepEqual(parseRich('```\nx\n```\n后面的话'), [
    { kind: 'block', text: 'x', lang: '' },
    { kind: 'text', text: '后面的话' },
  ]);
});

/* -------------------------------------------------------------------- 表格 */

test('表头 + 分隔行 + 数据行', () => {
  assert.deepEqual(parseRich('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'), [
    {
      kind: 'table',
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    },
  ]);
});

test('带对齐冒号的分隔行同样认', () => {
  assert.deepEqual(parseRich('| a | b |\n|:--|--:|\n| 1 | 2 |'), [
    { kind: 'table', header: ['a', 'b'], rows: [['1', '2']] },
  ]);
});

test('没有分隔行的竖线文本不算表格', () => {
  const out = parseRich('| a | b |\n不是分隔行');
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'text');
});

/* -------------------------------------------------------------------- 列表 */

test('无序列表归成一组', () => {
  assert.deepEqual(parseRich('- a\n- b'), [{ kind: 'list', ordered: false, items: ['a', 'b'] }]);
});

test('有序列表认得 1. 和 2) 两种写法', () => {
  assert.deepEqual(parseRich('1. a\n2) b'), [{ kind: 'list', ordered: true, items: ['a', 'b'] }]);
});

test('列表项里的行内标记交给渲染层，不在这里切', () => {
  assert.deepEqual(parseRich('- 用 `code` 试试'), [
    { kind: 'list', ordered: false, items: ['用 `code` 试试'] },
  ]);
});

/* ------------------------------------------------------------------ 网址 */

test('显式写了协议头的网址变成 link，句号留在正文里', () => {
  assert.deepEqual(parseRich('见 https://example.com/x。'), [
    { kind: 'text', text: '见 ' },
    { kind: 'link', text: 'https://example.com/x' },
    { kind: 'text', text: '。' },
  ]);
});

test('网址尾部的右括号和逗号被剥掉', () => {
  assert.deepEqual(parseRich('去 https://a.com/p), 然后'), [
    { kind: 'text', text: '去 ' },
    { kind: 'link', text: 'https://a.com/p' },
    { kind: 'text', text: '), 然后' },
  ]);
});

test('行内代码里的网址不是链接（那是命令参数）', () => {
  assert.deepEqual(parseRich('`https://example.com`'), [
    { kind: 'inline', text: 'https://example.com' },
  ]);
});

test('一段文字里多个网址各自成段', () => {
  assert.deepEqual(splitLinks('a https://x.com b https://y.com c'), [
    { kind: 'text', text: 'a ' },
    { kind: 'link', text: 'https://x.com' },
    { kind: 'text', text: ' b ' },
    { kind: 'link', text: 'https://y.com' },
    { kind: 'text', text: ' c' },
  ]);
});

test('没有网址时原样返回一段', () => {
  assert.deepEqual(splitLinks('没有任何链接'), [{ kind: 'text', text: '没有任何链接' }]);
});

/* -------------------------------------------------------- plainText（预览） */

test('表格压成一行文字，不留竖线', () => {
  assert.equal(plainText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a b 1 2');
});

test('列表去掉行首记号', () => {
  assert.equal(plainText('- a\n- b'), 'a b');
});

test('内链只留标题，不显示双括号', () => {
  assert.equal(plainText('看 [[目标笔记]]'), '看 目标笔记');
});

/* ----------------------------------------------------------- 导出静态 HTML */

test('escapeHtml 处理四个危险字符', () => {
  assert.equal(escapeHtml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
});

test('空行分段落，段内单换行变 <br>', () => {
  assert.equal(bodyToHtml('第一段\n第二行\n\n第二段'), '<p>第一段<br>第二行</p>\n<p>第二段</p>');
});

test('代码块带语言 class，尖括号被转义', () => {
  assert.equal(
    bodyToHtml('```js\nx < y\n```'),
    '<pre><code class="language-js">x &lt; y</code></pre>',
  );
});

test('表格包一层横向滚动容器', () => {
  assert.equal(
    bodyToHtml('| a |\n|---|\n| 1 |'),
    '<div class="table-scroll"><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>',
  );
});

test('列表导出成 ul / li', () => {
  assert.equal(bodyToHtml('- x\n- y'), '<ul><li>x</li><li>y</li></ul>');
});

test('正文里的 HTML 会被转义，不会被当成标签执行', () => {
  assert.equal(bodyToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('内链在静态导出里只留标题', () => {
  assert.equal(bodyToHtml('看 [[目标]]'), '<p>看 目标</p>');
});

test('网址在导出里变成可点的 a 标签', () => {
  assert.equal(
    bodyToHtml('见 https://example.com'),
    '<p>见 <a href="https://example.com" target="_blank" rel="noreferrer noopener">https://example.com</a></p>',
  );
});
