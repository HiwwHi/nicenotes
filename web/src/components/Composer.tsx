import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { timeLabel } from '../lib/date';
import { authToken } from '../store';
import type { HistoryVersion } from '../types';
import { CloseIcon } from './Icons';

interface Props {
  mode: 'create' | 'edit';
  initial: string;
  noteId?: string;
  onClose: () => void;
  onSubmit: (text: string) => Promise<boolean>;
}

export function Composer({ mode, initial, noteId, onClose, onSubmit }: Props) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

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
    if (ok) onClose();
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
          <h2>{mode === 'create' ? '记一条' : '编辑'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>

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
            }
          }}
          placeholder={'第一行写这一条最要紧的那句话，下面再补充。\n比如：probe 慢先怀疑 regulator 上电时序，别急着怪内核。'}
          rows={8}
        />

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
