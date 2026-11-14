/**
 * 把 Markdown 文件拆成一条条笔记。
 *
 * 规则只有两条，为了让你能预期结果：
 *   1. 文件里有 `## ` 二级标题 → 按它拆成多条（跳进代码块里的 ## 不算）
 *   2. 没有 → 整个文件当一条
 *
 * 不解析 Markdown 的其他语法：正文原样留着，反引号那部分交给 Rich 去渲染。
 * 导入是搬家，不是编辑器，多余的解释只会出错。
 */

export interface ParsedNote {
  title: string;
  body: string;
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.+)$/;

/** 按二级标题切成若干段，代码块内的 ## 不参与切分 */
function splitBySection(source: string): string[] {
  const marker = '## ';
  const lines = source.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let fenced = false;

  for (const line of lines) {
    if (FENCE.test(line.trim())) fenced = !fenced;

    if (!fenced && line.startsWith(marker)) {
      if (current.join('\n').trim()) chunks.push(current.join('\n'));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.join('\n').trim()) chunks.push(current.join('\n'));
  return chunks;
}

function toNote(fileName: string, chunk: string): ParsedNote {
  const lines = chunk.trim().split('\n');
  const first = (lines[0] ?? '').trim();
  const heading = first.match(HEADING);

  if (heading) {
    return {
      title: (heading[2] ?? '').trim() || '未命名',
      body: lines.slice(1).join('\n').trim(),
    };
  }

  // 没有标题行：用文件名当标题，正文保留第一行
  return {
    title: fileName.replace(/\.(md|markdown|txt)$/i, '').trim() || '未命名',
    body: chunk.trim(),
  };
}

export function parseMarkdownFile(fileName: string, text: string): ParsedNote[] {
  const source = text.replace(/\r\n?/g, '\n').trim();
  if (!source) return [];

  const chunks = splitBySection(source);
  const notes = (chunks.length > 1 ? chunks : [source]).map((chunk) => toNote(fileName, chunk));

  // 文件开头的一级标题下面常常没内容，那是文件的名字，不是一条笔记
  const meaningful = notes.filter((note) => note.body.trim().length > 0);
  return meaningful.length > 0 ? meaningful : notes.slice(0, 1);
}

/** 拼成笔记正文：第一行是标题，其余是内容，和手写的一条格式一致 */
export function toBody(note: ParsedNote): string {
  return note.body ? `${note.title}\n${note.body}` : note.title;
}

/**
 * 内容指纹，用来跳过重复导入。
 * 忽略空白差异 —— 同一个文件重新导出一次，不该变成两条笔记。
 */
export function contentHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  let hash = 0x811c9dc5;

  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
