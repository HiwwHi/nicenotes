import { initialsOf, looksLikeInitials } from './pinyin';
import type { StoredNote } from '../types';

/**
 * 关联度检索。
 *
 * 中文没有空格，用「二元组」切分（以太网 → 以太 / 太网），英文和数字按词切。
 * 打分是 TF-IDF 的简化版：词频用 log 压一下，越少见的词权重越高，
 * 首行（标题位）命中额外加权，最后按命中覆盖率做乘数。
 *
 * 整个过程纯本地、零依赖、毫秒级 —— 不需要联网，也不需要模型。
 */

const WORD = /^[a-z0-9_.#+-]+$/;

/** 把文本切成检索单元 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const source = text.toLowerCase();
  const pattern = /[\u4e00-\u9fff]+|[a-z0-9_.#+-]+/g;
  let found: RegExpExecArray | null;

  while ((found = pattern.exec(source)) !== null) {
    const segment = found[0];
    if (WORD.test(segment)) {
      out.push(segment);
      continue;
    }
    if (segment.length === 1) {
      out.push(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      out.push(segment.slice(i, i + 2));
    }
  }
  return out;
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

export interface SearchHit {
  note: StoredNote;
  /** 相对最高分的比例，用于展示排序强弱 */
  score: number;
  /** IDF 加权的命中覆盖率：这条笔记覆盖了查询里多少「有分量」的词 */
  coverage: number;
  /** 实际命中的检索单元，用来高亮 */
  matched: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** 查询被拆成的检索单元，用于高亮 */
  terms: string[];
  /** 结果里所有命中的单元（含同义展开），用于高亮正文 */
  marks: string[];
  /**
   * 有没有结果是靠拼音首字母才命中的。
   *
   * 这种命中在正文里标不出来（「ytw」和「以太网」没有共同的字），
   * 界面上得说明一句，否则用户看着一条完全没高亮的结果会以为搜错了。
   */
  usedPinyin: boolean;
}

interface Doc {
  note: StoredNote;
  counts: Map<string, number>;
  titleCounts: Map<string, number>;
  /** 英文词表，用来做前缀匹配（initcall → initcall_debug） */
  words: string[];
  /** 单个汉字计数。二元组索引里没有单字，搜「网」也得能找到「以太网」 */
  chars: Map<string, number>;
  /** 拼音首字母串，搜 ytw 找「以太网」用 */
  initials: string;
  length: number;
}

const CJK_CHAR = /[\u4e00-\u9fff]/;
const PLAIN_WORD = /^[a-z0-9_.#+-]+$/;

function toDoc(note: StoredNote): Doc {
  const counts = new Map<string, number>();
  const words: string[] = [];

  for (const token of tokenize(note.body)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (PLAIN_WORD.test(token)) words.push(token);
  }

  const chars = new Map<string, number>();
  for (const ch of note.body.toLowerCase()) {
    if (CJK_CHAR.test(ch)) chars.set(ch, (chars.get(ch) ?? 0) + 1);
  }

  const firstBreak = note.body.indexOf('\n');
  const titleText = firstBreak === -1 ? note.body : note.body.slice(0, firstBreak);
  const titleCounts = new Map<string, number>();
  for (const token of tokenize(titleText)) {
    titleCounts.set(token, (titleCounts.get(token) ?? 0) + 1);
  }

  return {
    note,
    counts,
    titleCounts,
    words,
    chars,
    initials: initialsOf(note.body),
    length: Math.max(24, note.body.length),
  };
}

/** 某个词在这篇笔记里出现几次。完全没命中时再做两级退让 */
function termFreq(doc: Doc, term: string): number {
  const direct = doc.counts.get(term);
  if (direct) return direct;

  // 单个汉字：bigram 索引里不会有它
  if (term.length === 1 && CJK_CHAR.test(term)) return doc.chars.get(term) ?? 0;

  // 英文前缀：initcall 应该能找到 initcall_debug
  if (term.length >= 3 && /^[a-z0-9]/.test(term)) {
    let total = 0;
    for (const word of doc.words) if (word.startsWith(term)) total += 1;
    return total;
  }

  return 0;
}

const TITLE_WEIGHT = 2.4;
const RECENCY_WEIGHT = 0.14;
const DAY = 86_400_000;
/** 拼音缩写命中的基础分：低于精确词命中，只用来补召回 */
const PINYIN_WEIGHT = 7;

/**
 * 按关联度检索。查询里用空格分成几段时，各段的结果会合并排序 ——
 * 命中段数越多的排越前，但不会因为少命中一段就被剔除。
 */
export function searchNotes(notes: StoredNote[], query: string, now = Date.now()): SearchResult {
  const text = query.trim();
  if (!text) return { hits: [], terms: [], marks: [], usedPinyin: false };

  const alive = notes.filter((note) => !note.deletedAt);
  const groups = text
    .split(/\s+/)
    .map((part) => uniq(tokenize(part)))
    .filter((part) => part.length > 0);

  // 全是标点之类的，退回到字面包含
  if (groups.length === 0) {
    const hits = alive
      .filter((note) => note.body.toLowerCase().includes(text.toLowerCase()))
      .map<SearchHit>((note) => ({ note, score: 100, coverage: 1, matched: [text] }));
    return { hits, terms: [text], marks: [text], usedPinyin: false };
  }

  const allTerms = uniq(groups.flat());
  const docs = alive.map(toDoc);
  const total = Math.max(1, docs.length);

  // 纯字母查询同时当拼音缩写试一次：打 ytw 也要能找到「以太网」
  const lowerText = text.toLowerCase();
  const latin = looksLikeInitials(lowerText) ? lowerText : null;

  const df = new Map<string, number>();
  for (const term of allTerms) {
    let count = 0;
    for (const doc of docs) if (termFreq(doc, term) > 0) count += 1;
    df.set(term, count);
  }

  const idfOf = (term: string) => Math.log(1 + total / (1 + (df.get(term) ?? 1)));
  const totalIdf = allTerms.reduce((sum, term) => sum + idfOf(term), 0);

  const scored = docs.map((doc) => {
    let raw = 0;
    const matched = new Set<string>();

    for (const group of groups) {
      let groupScore = 0;
      let groupHits = 0;
      for (const term of group) {
        const tf = termFreq(doc, term);
        if (tf === 0) continue;
        groupHits += 1;
        matched.add(term);
        const idf = idfOf(term);
        const titleBoost = doc.titleCounts.has(term) ? TITLE_WEIGHT : 1;
        groupScore += (1 + Math.log(tf)) * idf * titleBoost;
      }
      if (groupHits > 0) {
        // 覆盖率：这一段查的词命中比例越高，得分越可信
        raw += groupScore * (0.55 + 0.45 * (groupHits / group.length));
      }
    }

    // 拼音首字母命中：权重给得比精确词低一些，长缩写更可信
    let viaPinyin = false;
    if (latin && doc.initials.includes(latin)) {
      raw += PINYIN_WEIGHT + Math.min(6, latin.length - 2) * 1.5;
      // 只靠拼音才进来的：正文里没有任何字能和查询对上，高亮不出来
      viaPinyin = matched.size === 0;
    }

    if (raw <= 0) return null;

    // 长文不该因为长就占便宜，但也不该被重罚
    raw /= Math.sqrt(doc.length / 60);

    const ageDays = Math.max(0, (now - doc.note.updatedAt) / DAY);
    raw *= 1 + RECENCY_WEIGHT * Math.exp(-ageDays / 120);

    const matchedIdf = [...matched].reduce((sum, term) => sum + idfOf(term), 0);
    const coverage = totalIdf > 0 ? matchedIdf / totalIdf : 0;

    return { doc, raw, matched: [...matched], coverage, viaPinyin };
  });

  const kept = scored.filter((item): item is NonNullable<typeof item> => item !== null);
  if (kept.length === 0) return { hits: [], terms: allTerms, marks: [], usedPinyin: false };

  kept.sort((a, b) => b.raw - a.raw);
  const top = kept[0]!.raw;

  const hits = kept.map<SearchHit>((item) => ({
    note: item.doc.note,
    // 开平方让 0.3 和 0.9 的差距在视觉上更可读
    score: Math.round(Math.sqrt(item.raw / top) * 100),
    coverage: item.coverage,
    matched: item.matched,
  }));

  const usedPinyin = kept.some((item) => item.viaPinyin);

  return { hits, terms: allTerms, marks: uniq(hits.flatMap((hit) => hit.matched)), usedPinyin };
}

/**
 * 找出和某条笔记讲得最像的几条。展开一条笔记时用，
 * 就是「今天记的一点，和上周记的另一点其实是一件事」那个效果。
 *
 * 判定方式不是「相对分最高」，而是「有分量的词撞上了至少两个」：
 * 短文本里相对分很容易把唯一一个沾边的推成第一名，那等于乱推。
 */
export function relatedNotes(note: StoredNote, notes: StoredNote[], limit = 3): SearchHit[] {
  const pool = notes.filter((item) => item.id !== note.id && !item.deletedAt);
  if (pool.length === 0) return [];

  const cut = note.body.indexOf('\n');
  const title = (cut === -1 ? note.body : note.body.slice(0, cut)).trim();
  const source = title.length >= 4 ? title : note.body.slice(0, 120);
  if (source.trim().length < 4) return [];

  const docs = pool.map(toDoc);
  const terms = uniq(tokenize(source));
  const total = pool.length + 1;

  // 去掉「大半笔记里都有的词」：它们多半是「的是」「一个」这类组合，
  // 拿来做关联判断只会把不相干的东西凑到一起。
  const df = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const doc of docs) if (termFreq(doc, term) > 0) count += 1;
    df.set(term, count);
  }

  const common = Math.max(2, Math.floor(pool.length * 0.6));
  const weighted = terms
    .filter((term) => (df.get(term) ?? 0) < common)
    .map((term) => ({ term, idf: Math.log(1 + total / (1 + (df.get(term) ?? 1))) }))
    .sort((a, b) => b.idf - a.idf) as { term: string; idf: number }[];

  if (weighted.length < 2) return [];

  const scored = docs
    .map((doc) => {
      let hits = 0;
      let sum = 0;
      const matched: string[] = [];
      for (const item of weighted) {
        if (termFreq(doc, item.term) === 0) continue;
        hits += 1;
        sum += item.idf;
        matched.push(item.term);
      }
      return { doc, hits, sum, matched };
    })
    // 至少撞上三个词才算「讲得相近」。只撞两个的时候，多半是
    // 「怀疑」「时序」这类各说各话的巧合 —— 推出来只会让人觉得在乱猜。
    .filter((item) => item.hits >= 3);

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.sum - a.sum);
  const top = scored[0]!.sum;

  return scored.slice(0, limit).map((item) => ({
    note: item.doc.note,
    score: Math.round(Math.sqrt(item.sum / top) * 100),
    coverage: item.hits / weighted.length,
    matched: item.matched,
  }));
}

/** 把命中的词在文本里标出来（返回分段，交给 React 渲染） */export function highlight(text: string, marks: string[]): { text: string; hit: boolean }[] {
  if (marks.length === 0) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const spans: { start: number; end: number }[] = [];

  for (const mark of marks) {
    if (!mark) continue;
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(mark, from);
      if (index === -1) break;
      spans.push({ start: index, end: index + mark.length });
      from = index + 1;
      if (spans.length > 200) break;
    }
  }

  if (spans.length === 0) return [{ text, hit: false }];

  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  // 合并重叠区间：bigram 命中会互相压住，不合并会切得很碎
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), hit: false });
    parts.push({ text: text.slice(span.start, span.end), hit: true });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });

  return parts;
}

/**
 * 从命中位置附近截一小段做预览。
 *
 * 列表里的预览原本是正文开头，但搜索命中的词常常在几十行之后 ——
 * 那样你看到的一行跟搜索词毫无关系，等于白搜。
 */
export function snippet(text: string, marks: string[], length = 64): string {
  // 没有命中词也要截：这个函数的语义是「给一小段预览」，不是「原样返回」。
  // 现在调用方（NoteItem）已经先判过 marks 为空的情况，走不到这里，但
  // 下一个调用的人不该踩这个坑。
  if (marks.length === 0) return text.length > length ? `${text.slice(0, length)}…` : text;

  const lower = text.toLowerCase();
  let at = -1;

  for (const mark of marks) {
    if (!mark) continue;
    const index = lower.indexOf(mark);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }

  if (at === -1) return text.slice(0, length);

  // 命中点偏左放，右边多留一点上下文
  const start = Math.max(0, at - Math.floor(length / 3));
  const end = Math.min(text.length, start + length);
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim();

  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}
