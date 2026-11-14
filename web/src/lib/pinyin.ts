import { PINYIN_GROUPS } from './pinyin-table';

/**
 * 拼音首字母检索。
 *
 * 目的只有一个：中文输入法下，脑子里先出现的是读音。想到「以太网」
 * 手上打出来的是 ytw，不该逼人切输入法。
 */

let table: Map<string, string> | null = null;

function getTable(): Map<string, string> {
  if (table) return table;

  table = new Map();
  for (const [letter, chars] of Object.entries(PINYIN_GROUPS)) {
    for (const ch of chars) table.set(ch, letter);
  }
  return table;
}

/**
 * 把文本压成一串首字母，只保留汉字。
 *
 * 不插入分隔符是刻意的：`probe 慢先怀疑` 会得到 `m x h y`，
 * 用户打 `mxhy` 也应该能命中。代价是跨词可能误连，
 * 但搜索场景里「多给一条」比「搜不到」好。
 */
export function initialsOf(text: string): string {
  const map = getTable();
  let out = '';

  for (const ch of text) {
    const letter = map.get(ch);
    if (letter) out += letter;
  }

  return out;
}

/** 看起来像不像拼音缩写：纯小写字母，两个以上 */
export function looksLikeInitials(query: string): boolean {
  return /^[a-z]{2,12}$/.test(query);
}
