import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { timeLabelPrecise } from '../lib/date';
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
  const { account } = useApp();
  const [busy, setBusy] = useState(false);
  /** 写代码块的时候，得能先看一眼渲染成什么样再存 */
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

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
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      // 在预览态也能存。那时 textarea 不在页面上，只有全局监听接得住
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) {
      dropDraft();
      onClose();
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
        if (event.target === event.currentTarget) onClose();
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
                onClick={() => setTab('write')}
              >
                写
              </button>
              <button
                type="button"
                className={tab === 'preview' ? 'is-active' : ''}
                onClick={() => setTab('preview')}
              >
                预览
              </button>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
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
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+Enter 走全局监听，这里只管 Tab 缩进
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
                    ? `超了 ${text.length - MAX_BODY} 字，保存时会被截掉`
                    : `已写 ${text.length} 字，上限 ${MAX_BODY}`}
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
            <button type="button" className="btn btn-ghost" onClick={onClose}>
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
