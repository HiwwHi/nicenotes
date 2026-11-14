/**
 * 最近搜过的词。
 *
 * 只存在本地，最多 8 条。目的是省掉重新打一遍常见查询的力气 ——
 * 技术笔记里反复搜的常常是同样几个词（probe、dts、-517）。
 */

const KEY = 'nicenotes.searches';
const LIMIT = 8;

export function readSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === 'string').slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberSearch(current: string[], text: string): string[] {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!value) return current;

  const next = [value, ...current.filter((item) => item !== value)].slice(0, LIMIT);
  if (next.length === current.length && next.every((item, index) => item === current[index])) {
    return current;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 无痕模式写不进去，忽略 */
  }
  return next;
}

export function clearSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
