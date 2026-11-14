/**
 * 极简语法着色，不引第三方库。
 *
 * 只做「让人一眼分清哪是注释、哪是字符串、哪是数字」这一层 ——
 * 完整的高亮器要几百 KB，而代码笔记真正需要区分的就这几类。
 *
 * 做法是逐位置尝试规则：每条规则都是 sticky 正则，只有正好从当前位置
 * 才开始匹配才算命中。所以规则顺序就是优先级，注释排在最前，
 * 字符串里的 # 才不会被当成注释。
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'variable' | 'meta';

export interface Token {
  text: string;
  kind: TokenKind;
}

interface Rule {
  kind: TokenKind;
  re: RegExp;
}

const rule = (kind: TokenKind, source: string): Rule => ({
  kind,
  re: new RegExp(source, 'y'),
});

const COMMON: Rule[] = [
  rule('comment', String.raw`\/\/[^\n]*`),
  rule('comment', String.raw`#[^\n]*`),
  rule('comment', String.raw`\/\*[\s\S]*?\*\/`),
  rule('string', String.raw`"(?:[^"\\\n]|\\.)*"`),
  rule('string', String.raw`'(?:[^'\\\n]|\\.)*'`),
  rule('number', String.raw`\b0[xX][0-9a-fA-F]+\b`),
  rule('number', String.raw`\b\d+(?:\.\d+)?\b`),
];

const SHELL: Rule[] = [
  rule('comment', String.raw`#[^\n]*`),
  rule('string', String.raw`"(?:[^"\\]|\\.)*"`),
  rule('string', String.raw`'[^']*'`),
  rule('variable', String.raw`\$\{[^}]*\}`),
  rule('variable', String.raw`\$[A-Za-z_][A-Za-z0-9_]*`),
  rule('variable', String.raw`\$[0-9@*#?]`),
  rule('number', String.raw`\b0[xX][0-9a-fA-F]+\b`),
  rule('number', String.raw`\b\d+(?:\.\d+)?\b`),
  rule(
    'keyword',
    String.raw`\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|export|local|source|sudo|echo|printf|cat|grep|awk|sed|cut|sort|uniq|head|tail|xargs|find|chmod|chown|mount|umount|df|free|top|ps|kill|strace|lsmod|insmod|rmmod|modprobe|dmesg|i2cdetect|i2cget|i2cset|objdump|readelf|nm|gcc|make|git|dd|tee)\b`,
  ),
];

const C_LIKE: Rule[] = [
  rule('comment', String.raw`\/\/[^\n]*`),
  rule('comment', String.raw`\/\*[\s\S]*?\*\/`),
  rule('meta', String.raw`#[ \t]*(?:include|define|undef|ifdef|ifndef|endif|else|elif|pragma)[^\n]*`),
  rule('string', String.raw`"(?:[^"\\\n]|\\.)*"`),
  rule('string', String.raw`'(?:[^'\\\n]|\\.)*'`),
  rule('number', String.raw`\b0[xX][0-9a-fA-F]+[uUlL]*\b`),
  rule('number', String.raw`\b\d+[uUlLfF]*\b`),
  rule(
    'keyword',
    String.raw`\b(?:if|else|for|while|do|switch|case|default|break|continue|return|goto|sizeof|struct|union|enum|typedef|static|extern|const|volatile|inline|void|char|short|int|long|float|double|signed|unsigned|bool|true|false|NULL|register|auto)\b`,
  ),
];

const DTS: Rule[] = [
  rule('comment', String.raw`\/\/[^\n]*`),
  rule('comment', String.raw`\/\*[\s\S]*?\*\/`),
  rule('string', String.raw`"(?:[^"\\\n]|\\.)*"`),
  rule('variable', String.raw`&[A-Za-z_][\w-]*`),
  rule('number', String.raw`<(?:0[xX][0-9a-fA-F]+|\d+)(?:\s+(?:0[xX][0-9a-fA-F]+|\d+))*>`),
  rule('number', String.raw`\b0[xX][0-9a-fA-F]+\b`),
  rule(
    'keyword',
    String.raw`\b(?:compatible|reg|status|interrupts|clocks|clock-names|gpios|phandle|reset-gpios)\b`,
  ),
];

function rulesFor(rawLang: string): Rule[] {
  const lang = rawLang.trim().toLowerCase();
  if (!lang) return COMMON;
  if (/^(sh|bash|shell|zsh|console|shellsession|ksh)$/.test(lang)) return SHELL;
  if (/^(c|h|cpp|cc|cxx|objc|ino)$/.test(lang)) return C_LIKE;
  if (/^(dts|dtsi|dtso)$/.test(lang)) return DTS;
  return COMMON;
}

export function highlightCode(code: string, lang: string): Token[] {
  const rules = rulesFor(lang);
  const tokens: Token[] = [];

  let pos = 0;
  let plainFrom = 0;

  while (pos < code.length) {
    let hit: { kind: TokenKind; text: string } | null = null;

    for (const item of rules) {
      item.re.lastIndex = pos;
      const found = item.re.exec(code);
      if (found && found.index === pos && found[0].length > 0) {
        hit = { kind: item.kind, text: found[0] };
        break;
      }
    }

    if (!hit) {
      pos += 1;
      continue;
    }

    if (pos > plainFrom) tokens.push({ kind: 'plain', text: code.slice(plainFrom, pos) });
    tokens.push(hit);

    pos += hit.text.length;
    plainFrom = pos;
  }

  if (plainFrom < code.length) tokens.push({ kind: 'plain', text: code.slice(plainFrom) });
  return tokens;
}
