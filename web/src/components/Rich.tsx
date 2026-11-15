import { Fragment, useState } from 'react';
import { writeClipboard } from '../lib/clipboard';
import { parseRich } from '../lib/rich';
import { highlight } from '../lib/search';
import { highlightCode } from '../lib/syntax';

/** 纯文本 + 搜索高亮。标题、预览这种单行位置用它 */
export function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (marks.length === 0) return <>{text}</>;

  return (
    <>
      {highlight(text, marks).map((part, index) =>
        part.hit ? (
          <mark key={index} className="hit">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * 代码块。
 *
 * 带一个复制按钮：从笔记里把命令捞到终端，不该还要手动框选。
 * 语法着色和搜索高亮要能同时出现 —— 搜到一段代码，既想知道哪行命中，
 * 也想看清哪是注释。所以先切 token，再把每个 token 内部做高亮。
 */
function CodeBlock({ text, lang, marks }: { text: string; lang: string; marks: string[] }) {
  const [copied, setCopied] = useState(false);
  const tokens = highlightCode(text, lang);

  async function copy() {
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="code-wrap">
      {/* prettier-ignore */}
      <pre className="code" data-lang={lang || undefined}><code>{tokens.map((token, i) => {
        const inner = <Marked text={token.text} marks={marks} />;
        return token.kind === 'plain' ? (
          <Fragment key={i}>{inner}</Fragment>
        ) : (
          <span key={i} className={`tok-${token.kind}`}>{inner}</span>
        );
      })}</code></pre>
      <button type="button" className="code-copy" onClick={() => void copy()}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

/** 点内链时通知外面去跳转。用事件而不是一层层传 props，渲染组件不该关心导航 */
const OPEN_EVENT = 'nicenotes:open-note';

/** 带代码的正文：`行内`、``` 围栏块、[[笔记链接]] */
export function Rich({ text, marks = [] }: { text: string; marks?: string[] }) {
  const segments = parseRich(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'wiki') {
          return (
            <button
              key={index}
              type="button"
              className="wikilink"
              title={`跳到「${segment.text}」`}
              onClick={() =>
                window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { title: segment.text } }))
              }
            >
              {segment.text}
            </button>
          );
        }

        if (segment.kind === 'inline') {
          return (
            <code key={index} className="icode">
              <Marked text={segment.text} marks={marks} />
            </code>
          );
        }

        if (segment.kind === 'block') {
          return <CodeBlock key={index} text={segment.text} lang={segment.lang} marks={marks} />;
        }

        return <Marked key={index} text={segment.text} marks={marks} />;
      })}
    </>
  );
}
