import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { timeLabel } from '../lib/date';
import { authToken } from '../store';
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

export function Composer({ mode, initial, noteId, onClose, onSubmit }: Props) {
  /**
   * 新建时先把上次没写完的草稿捡回来。
   * 手机上记东西最容易被打断（来电、切走、误关），写了一半全没了很伤。
   */
  const [text, setText] = useState(() => {
    if (mode !== 'create' || initial) return initial;
    try {
      return localStorage.getItem(DRAFT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [restored] = useState(() => {
    if (mode !== 'create' || initial) return false;
    try {
      return Boolean(localStorage.getItem(DRAFT_KEY));
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  /** 写代码块的时候，得能先看一眼渲染成什么样再存 */
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 边写边存，停手半秒就落盘
  useEffect(() => {
    if (mode !== 'create') return;

    if (!text.trim()) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, text);
      } catch {
        /* 无痕模式写不进去 */
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [text, mode]);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
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
            {restored && <span className="draft-badge">接着上次没写完的</span>}
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
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
                return;
              }

              // 写代码时 Tab 该缩进，而不是把焦点跳到下一个控件上
              if (event.key === 'Tab') {
                event.preventDefault();
                const area = event.currentTarget;
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
          </div>
          <div className="sheet-actions">
            {mode === 'edit' && noteId ? (
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
                <div className="history-meta">{timeLabel(version.replacedAt)}</div>
                <p className="history-body">{version.body}</p>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setText(version.body);
                    setVersions(null);
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
