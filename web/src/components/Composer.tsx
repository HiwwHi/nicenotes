import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { splitBody, timeLabelPrecise } from '../lib/date';
import { plainText } from '../lib/rich';
import { authToken, MAX_BODY, toast, useApp } from '../store';
import type { HistoryVersion } from '../types';
import { CloseIcon } from './Icons';
import { Rich } from './Rich';

interface Props {
  mode: 'create' | 'edit';
  initial: string;
  noteId?: string;
  onClose: () => void;
  onSubmit: (text: string) => Promise<boolean>;
}

const DRAFT_KEY = 'nicenotes.draft';

/**
 * 草稿：新建的笔记和改到一半的笔记都存。
 *
 * 只存新建的那一份是不够的 —— 编辑一条长笔记时切走应用、标签页被系统回收，
 * 回来改动全没了，而且没有任何痕迹。存在同一个键里，用 noteId 区分是谁的：
 * null 表示「还没存过的新笔记」。
 */
interface Draft {
  text: string;
  noteId: string | null;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    // 老格式是直接存的纯文本，没有 JSON 头
    if (!raw.startsWith('{')) return { text: raw, noteId: null };
    const parsed = JSON.parse(raw) as { text?: unknown; noteId?: unknown };
    if (typeof parsed.text !== 'string') return null;
    return { text: parsed.text, noteId: typeof parsed.noteId === 'string' ? parsed.noteId : null };
  } catch {
    return null;
  }
}

function writeDraft(text: string, noteId: string | null): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, noteId } satisfies Draft));
  } catch {
    /* 无痕模式写不进去 */
  }
}

export function Composer({ mode, initial, noteId, onClose, onSubmit }: Props) {
  /**
   * 新建时先把上次没写完的草稿捡回来。
   * 手机上记东西最容易被打断（来电、切走、误关），写了一半全没了很伤。
   */
  const wanted = mode === 'edit' ? (noteId ?? null) : null;
  const [text, setText] = useState(() => {
    const draft = readDraft();
    if (draft && draft.noteId === wanted && draft.text.trim()) return draft.text;
    return initial;
  });
  const [restored] = useState(() => {
    const draft = readDraft();
    return Boolean(draft && draft.noteId === wanted && draft.text.trim());
  });
  const { account, notes } = useApp();
  // 给 closeWithHint 用：effect 里的闭包拿不到最新的 text
  const textRef = useRef(text);
  textRef.current = text;
  const [busy, setBusy] = useState(false);
  /** 写代码块的时候，得能先看一眼渲染成什么样再存 */
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /** 切到预览再切回来时，把滚动位置还原 —— 长笔记写到一半想看看效果，
      回来发现又从头开始了 */
  const scrollRef = useRef(0);

  // 边写边存，停手半秒就落盘。新建和编辑都存
  useEffect(() => {
    if (!text.trim()) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    const timer = window.setTimeout(() => writeDraft(text, wanted), 500);
    return () => window.clearTimeout(timer);
  }, [text, wanted]);

  function dropDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  const submitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 输入法正在拼：这一下 Esc 是「取消这次输入」，不是「关掉编辑器」
      if (event.isComposing) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        closeWithHint();
        return;
      }

      // 在预览态也能存。那时 textarea 不在页面上，只有全局监听接得住
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitRef.current();
        return;
      }

      /*
       * Ctrl/Cmd+S 也存。写到一半手会自己按这个 —— 不接的话弹出来的是
       * 浏览器的「保存网页」，把整个应用存成一个文件。
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        submitRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * 关掉编辑框，顺口说一句内容去哪了。
   *
   * 草稿一直在存（新建和编辑都存），但关掉的那一刻什么都不说 ——
   * 用户只看见弹窗消失，会以为自己写的一堆东西没了。
   */
  function closeWithHint() {
    /*
     * 必须读 ref。Esc 走的是 useEffect 里的 document 监听，那个 effect 只
     * 依赖 onClose —— 闭包里拿到的 text 会一直停在首次渲染（空字符串），
     * 判断成「没写东西」就什么都不提示。
     */
    const current = textRef.current;
    const dirty = current.trim().length > 0 && current !== initial;
    onClose();
    if (dirty) {
      toast(mode === 'edit' ? '改动留作草稿了，下次打开还在' : '内容留作草稿了，下次按 N 还在');
    }
  }

  /* -------------------------------------------------- 内链补全 */

  /**
   * 输入 [[ 之后列出能接上去的笔记标题。
   *
   * 记笔记时想连另一条，得先记得那条的标题怎么写 —— 记不住就只能先去翻一遍。
   * 打出 [[ 就给出候选，Enter 或 Tab 接上，Esc 退出。
   */
  const [suggest, setSuggest] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const candidates = useMemo(() => {
    if (!suggest) return [];
    const query = suggest.query.trim().toLowerCase();

    const seen = new Set<string>();
    const list: string[] = [];

    /*
     * 新的排在前面。
     *
     * 按数组原顺序走的话，`[[` 一打出来最前面全是几个月前的旧笔记 ——
     * 而想连的那条，通常是刚写的。
     */
    const ordered = [...notes].sort((a, b) => b.createdAt - a.createdAt);

    for (const note of ordered) {
      if (note.deletedAt || note.id === noteId) continue;
      const title = plainText(splitBody(note.body).title).trim();
      if (!title || seen.has(title)) continue;
      if (query && !title.toLowerCase().includes(query)) continue;
      seen.add(title);
      list.push(title);
      if (list.length >= 6) break;
    }
    return list;
  }, [notes, noteId, suggest]);

  /** 光标前是不是一个还没收尾的 [[ */
  function detectLink(value: string, caret: number) {
    const before = value.slice(0, caret);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;

    const between = before.slice(open + 2);
    // 已经有 ]] 或者跨行了，说明不是正在写内链
    if (between.includes(']]') || between.includes('\n')) return null;
    if (between.length > 40) return null;

    return { start: open, end: caret, query: between };
  }

  function applySuggestion(title: string) {
    if (!suggest) return;
    const next = `${text.slice(0, suggest.start)}[[${title}]]${text.slice(suggest.end)}`;
    const caret = suggest.start + title.length + 4;

    setText(next);
    setSuggest(null);

    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  }

  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true);

    /*
     * 必须 try/finally。存储写不进去（配额满、隐私模式、库被别处删了）
     * 时 onSubmit 会抛错 —— 以前那句 setBusy(false) 就走不到，按钮永远
     * 停在「存着…」，用户只能刷新。
     */
    try {
      const ok = await onSubmit(text);
      if (ok) {
        dropDraft();
        onClose();
      }
    } catch (error) {
      // 浏览器的原文是英文的（The quota has been exceeded.），
      // 而且没说该怎么办
      const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
      toast(
        quota
          ? '本机存储满了。先导出一份备份，再清掉一些旧笔记试试'
          : '没存上，内容还在编辑框里，可以再试一次',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  submitRef.current = () => {
    void submit();
  };

  async function loadHistory() {
    if (!noteId) return;
    const token = authToken();
    if (!token) {
      setHistoryError('登录后才会有云端历史');
      return;
    }
    try {
      const result = await api.history(token, noteId);
      setVersions(result.versions);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '读取失败');
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeWithHint();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={mode === 'create' ? '记一条' : '编辑笔记'}>
        <header className="sheet-head">
          <h2>
            {mode === 'create' ? '记一条' : '编辑'}
            {restored && (
              <span className="draft-badge">{mode === 'edit' ? '接着上次改到一半的' : '接着上次没写完的'}</span>
            )}
          </h2>

          <div className="sheet-tools">
            <div className="order-switch" role="group" aria-label="写或预览">
              <button
                type="button"
                className={tab === 'write' ? 'is-active' : ''}
                onClick={() => {
                  setTab('write');
                  requestAnimationFrame(() => {
                    if (areaRef.current) areaRef.current.scrollTop = scrollRef.current;
                  });
                }}
              >
                写
              </button>
              <button
                type="button"
                className={tab === 'preview' ? 'is-active' : ''}
                onClick={() => {
                  scrollRef.current = areaRef.current?.scrollTop ?? 0;
                  setTab('preview');
                }}
              >
                预览
              </button>
            </div>
            <button type="button" className="icon-btn" onClick={closeWithHint} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
        </header>

        {tab === 'write' ? (
          <textarea
            ref={areaRef}
            className="sheet-area"
            value={text}
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setActiveIdx(0);
              setSuggest(detectLink(event.target.value, event.target.selectionStart ?? 0));
            }}
            onBlur={() => setSuggest(null)}
            onKeyDown={(event) => {
              // Ctrl+Enter 走全局监听，这里只管 Tab 缩进
              // 补全浮层开着的时候，方向键和回车先归它用
              if (suggest && candidates.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIdx((index) => (index + 1) % candidates.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIdx((index) => (index - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  const picked = candidates[activeIdx] ?? candidates[0];
                  if (picked) applySuggestion(picked);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSuggest(null);
                  return;
                }
              }

              if (event.key === 'Tab') {
                const area = event.currentTarget;

                /*
                 * Shift+Tab：行首有缩进就退一级；没有就放行，让焦点跳到上一个
                 * 控件。全拦掉的话键盘用户被关在这个框里 —— 只能靠 Esc 或
                 * Ctrl+Enter 出去，想按一下关闭按钮都做不到。
                 */
                if (event.shiftKey) {
                  const { value, selectionStart } = area;
                  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
                  const lead = value.slice(lineStart, selectionStart);
                  const strip = lead.endsWith('  ') ? 2 : lead.endsWith(' ') || lead.endsWith('\t') ? 1 : 0;

                  if (strip === 0) return;

                  event.preventDefault();
                  area.setRangeText('', selectionStart - strip, selectionStart, 'end');
                  setText(area.value);
                  return;
                }

                event.preventDefault();
                area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
                setText(area.value);
              }
            }}
            placeholder={'第一行写这一条最要紧的那句话，下面再补充。\n贴命令或 log 用三个反引号包起来；想连到另一条笔记，写 [[那条的标题]]。'}
            rows={8}
          />
        ) : (
          <div className="sheet-preview">
            {text.trim() ? <Rich text={text} /> : <p className="sheet-empty">还没有内容</p>}
          </div>
        )}

        {tab === 'write' && suggest && candidates.length > 0 && (
          <div className="link-suggest" role="listbox" aria-label="补全笔记标题">
            {candidates.map((title, index) => (
              <button
                key={title}
                type="button"
                role="option"
                aria-selected={index === activeIdx}
                className={`link-suggest-item ${index === activeIdx ? 'is-active' : ''}`}
                // 用 mousedown 而不是 click：click 之前 textarea 会先 blur，
                // 浮层就没了，点了个寂寞
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(title);
                }}
                onMouseEnter={() => setActiveIdx(index)}
              >
                <span className="link-suggest-mark">[[</span>
                {title}
              </button>
            ))}
            <p className="link-suggest-hint">↑↓ 选，Enter 接上，Esc 不管它</p>
          </div>
        )}

        <footer className="sheet-foot">
          <div className="sheet-tips">
            <span>第一行会当标题</span>
            <span className="dot-sep" />
            <span>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存
            </span>
            {/*
             * 写到快满时才提示。平时不占地方，真要超了当场就知道，
             * 不用等保存完看那条「只存了前 2 万字符」。
             */}
            {text.length > MAX_BODY * 0.85 && (
              <>
                <span className="dot-sep" />
                <span className={text.length > MAX_BODY ? 'tip-over' : 'tip-near'}>
                  {text.length > MAX_BODY
                    ? `超了 ${(text.length - MAX_BODY).toLocaleString('zh-CN')} 字，保存时会被截掉`
                    : `已写 ${text.length.toLocaleString('zh-CN')} 字，上限 ${MAX_BODY.toLocaleString('zh-CN')}`}
                </span>
              </>
            )}
          </div>
          <div className="sheet-actions">
            {/*
             * 没登录就没有云端历史。之前按钮照常显示，点了才告诉你「登录后才有」，
             * 等于让人白点一下 —— 干脆不出现。
             */}
            {mode === 'edit' && noteId && account ? (
              <button type="button" className="btn btn-ghost" onClick={() => void loadHistory()}>
                历史版本
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={closeWithHint}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
              {busy ? '保存中' : '保存'}
            </button>
          </div>
        </footer>

        {historyError && <p className="sheet-note">{historyError}</p>}

        {versions && (
          <div className="history">
            <p className="history-title">历史版本（{versions.length}）</p>
            {versions.length === 0 && <p className="history-empty">还没有旧版本。改过一次被覆盖后才会出现。</p>}
            {versions.map((version) => (
              <div className="history-row" key={`${version.replacedAt}-${version.savedAt}`}>
                <div className="history-meta">{timeLabelPrecise(version.replacedAt)}</div>
                <p className="history-body">{version.body}</p>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setText(version.body);
                    setVersions(null);
                    // 只是填回输入框，还没落盘。不说一句的话，用户以为已经恢复了，
                    // 关掉弹窗才发现什么都没变。
                    toast('已填回输入框，记得按保存', 'warn');
                  }}
                >
                  恢复这一版
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
