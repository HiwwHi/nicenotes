import { Fragment } from 'react';
import { parseRich } from '../lib/rich';
import { highlight } from '../lib/search';

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

/** 带代码的正文：`行内` 和 ``` 围栏块 */
export function Rich({ text, marks = [] }: { text: string; marks?: string[] }) {
  const segments = parseRich(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'inline') {
          return (
            <code key={index} className="icode">
              <Marked text={segment.text} marks={marks} />
            </code>
          );
        }

        if (segment.kind === 'block') {
          // 整个 pre/code 必须写成一行：JSX 会在换行处插入空白，
          // 而 <pre> 会把那个空白当内容显示出来。
          return (
            <pre key={index} className="code" data-lang={segment.lang || undefined}><code><Marked text={segment.text} marks={marks} /></code></pre>
          );
        }

        return <Marked key={index} text={segment.text} marks={marks} />;
      })}
    </>
  );
}
