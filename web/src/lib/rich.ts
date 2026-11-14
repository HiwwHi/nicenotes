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
  | { kind: 'block'; text: string; lang: string };

const FENCE_OPEN = /^```([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const INLINE = /`([^`\n]+)`/g;

function splitInline(text: string): Segment[] {
  const parts: Segment[] = [];
  INLINE.lastIndex = 0;

  let cursor = 0;
  let found: RegExpExecArray | null;
  while ((found = INLINE.exec(text)) !== null) {
    if (found.index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, found.index) });
    parts.push({ kind: 'inline', text: found[1] ?? '' });
    cursor = found.index + found[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });

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

  for (const line of lines) {
    if (!fenced) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        flush();
        fenced = true;
        lang = open[1] ?? '';
        body = [];
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

  // 围栏没闭合（写到一半就保存了）：原样还回去，别把后面的内容吞掉
  if (fenced) {
    buffer.push(`\`\`\`${lang}`, ...body);
  }
  flush();

  return out.flatMap((segment) => (segment.kind === 'text' ? splitInline(segment.text) : [segment]));
}

/** 去掉记号，用来做列表预览、标题这类只能显示单行的地方 */
export function plainText(input: string): string {
  return input
    .replace(/^```[\w+#.-]*\s*$/gm, ' ')
    .replace(/```/g, ' ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
