/**
 * 极轻的富文本切分。
 *
 * 只认两种记号：行内 `code` 和 ``` 围栏代码块。
 * 不引入 Markdown 库 —— 笔记里真正需要排版的只有代码，
 * 而完整 Markdown 会把「你随手写的 * 和 -」变成意料之外的列表。
 */

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'inline'; text: string }
  | { kind: 'block'; text: string; lang: string }
  /** [[另一条笔记的标题]] */
  | { kind: 'wiki'; text: string }
  /** https://… 显式写了协议头的链接 */
  | { kind: 'link'; text: string }
  /** | 表头 | 表头 | 加一行 |---|---| */
  | { kind: 'table'; header: string[]; rows: string[][] }
  /** - 一条 或者 1. 一条 */
  | { kind: 'list'; ordered: boolean; items: string[] };

const FENCE_OPEN = /^```([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const INLINE = /`([^`\n]+)`|\[\[([^[\]\n]+)\]\]/g;
const WIKI = /\[\[([^[\]\n]+)\]\]/g;

/*
 * 只认显式写了 http(s):// 的地址，不猜裸域名。
 * 笔记里 www 开头和 a.b.c 这种更像文件名或版本号，猜错比不猜更烦。
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`）】，。]+/g;
/** 句末标点不该被吃进链接里 */
const URL_TRAILING = /[.,;:!?、)\]}>]+$/;

/** 表格分隔行：|---|---| 或者带对齐的 |:--|--:| */
function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('-') && /^[|\s:-]+$/.test(trimmed) && trimmed.includes('|');
}

/** 列表项：- xxx、* xxx、1. xxx、1) xxx */
const LIST_ITEM = /^\s*([-*]|\d+[.)])\s+(.+)$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * 把一段普通文字里写着的 http(s) 地址挑出来。
 *
 * 只在「纯文字」片段上跑：行内代码和围栏里的内容不该变成可点链接 ——
 * 那里面出现 URL 是命令参数，不是让你点的。
 *
 * 导出 HTML 那一路也用它，保证两处对「哪一段算网址」的判断一致。
 */
/** splitLinks 只会吐出这两种，类型收窄一点，调用方不用再挨个排除 */
export type LinkPiece = { kind: 'text'; text: string } | { kind: 'link'; text: string };

export function splitLinks(text: string): LinkPiece[] {
  const parts: LinkPiece[] = [];
  URL_PATTERN.lastIndex = 0;

  let cursor = 0;
  let found: RegExpExecArray | null;
  while ((found = URL_PATTERN.exec(text)) !== null) {
    const tail = found[0].match(URL_TRAILING)?.[0] ?? '';
    const url = tail ? found[0].slice(0, -tail.length) : found[0];

    // 只剩个协议头（http://）就别当链接了
    if (url.length <= 'https://'.length) continue;

    if (found.index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, found.index) });
    parts.push({ kind: 'link', text: url });
    cursor = found.index + url.length;
  }

  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: 'text', text }];
}

function splitInline(text: string): Segment[] {
  const parts: Segment[] = [];
  INLINE.lastIndex = 0;

  let cursor = 0;
  let found: RegExpExecArray | null;
  while ((found = INLINE.exec(text)) !== null) {
    if (found.index > cursor) parts.push(...splitLinks(text.slice(cursor, found.index)));

    if (found[1] !== undefined) {
      parts.push({ kind: 'inline', text: found[1] });
    } else if (found[2] && found[2].trim()) {
      parts.push({ kind: 'wiki', text: found[2].trim() });
    } else {
      // 空链接之类的，原样留着
      parts.push({ kind: 'text', text: found[0] });
    }

    cursor = found.index + found[0].length;
  }
  if (cursor < text.length) parts.push(...splitLinks(text.slice(cursor)));

  return parts.length > 0 ? parts : [{ kind: 'text', text }];
}

export function parseRich(input: string): Segment[] {
  const lines = input.split('\n');
  const out: Segment[] = [];
  let buffer: string[] = [];
  let fenced = false;
  let lang = '';
  let body: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    out.push({ kind: 'text', text: buffer.join('\n') });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (!fenced) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        flush();
        fenced = true;
        lang = open[1] ?? '';
        body = [];
        continue;
      }

      // 表格：这一行以 | 开头，下一行是 |---|---| 分隔行
      const next = lines[i + 1] ?? '';
      if (line.trim().startsWith('|') && isTableDivider(next)) {
        flush();
        const header = splitRow(line);
        const rows: string[][] = [];
        let j = i + 2;

        while (j < lines.length && (lines[j] ?? '').trim().startsWith('|')) {
          rows.push(splitRow(lines[j] ?? ''));
          j += 1;
        }

        out.push({ kind: 'table', header, rows });
        i = j - 1;
        continue;
      }

      // 列表：连续的 - / * / 1. 开头行归成一组
      const listMatch = line.match(LIST_ITEM);
      if (listMatch) {
        flush();
        const items: string[] = [];
        const ordered = /^\d/.test(listMatch[1] ?? '');
        let j = i;

        while (j < lines.length) {
          const itemMatch = (lines[j] ?? '').match(LIST_ITEM);
          if (!itemMatch) break;
          items.push(itemMatch[2] ?? '');
          j += 1;
        }

        out.push({ kind: 'list', ordered, items });
        i = j - 1;
        continue;
      }

      buffer.push(line);
      continue;
    }

    if (FENCE_CLOSE.test(line)) {
      out.push({ kind: 'block', text: body.join('\n'), lang });
      fenced = false;
      lang = '';
      body = [];
      continue;
    }

    body.push(line);
  }

  // 围栏没闭合：当成代码块一直延续到文末。
  // 写在笔记里基本都是「忘了收尾」，退回去当普通文本反而把格式丢了。
  if (fenced) {
    out.push({ kind: 'block', text: body.join('\n'), lang });
  }
  flush();

  return out.flatMap((segment) => (segment.kind === 'text' ? splitInline(segment.text) : [segment]));
}

/** 去掉记号，用来做列表预览、标题这类只能显示单行的地方 */
export function plainText(input: string): string {
  return input
    .replace(/^```[\w+#.-]*\s*$/gm, ' ')
    .replace(/```/g, ' ')
    // 表格：分隔行整行删掉，竖线换空格，预览里不该出现一堆 |
    .replace(/^\|?[\s:-]+\|[\s:|-]*$/gm, ' ')
    .replace(/\|/g, ' ')
    // 列表：去掉行首的 - / * / 1.
    .replace(/^\s*([-*]|\d+[.)])\s+/gm, '')
    .replace(WIKI, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
