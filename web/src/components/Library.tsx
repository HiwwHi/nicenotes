import { useMemo, useRef, useState } from 'react';
import { dueLabel, pastLabel, splitBody } from '../lib/date';
import { isNew } from '../lib/scheduler';
import { buildHeatmap, computeStreak, totalReviews } from '../lib/stats';
import { buildExport, importJson, toast } from '../store';
import type { StoredNote } from '../types';
import { SearchIcon, TrashIcon } from './Icons';

interface Props {
  notes: StoredNote[];
  log: Record<string, number>;
  onEdit: (note: StoredNote) => void;
  onDelete: (id: string) => void;
}

export function Library({ notes, log, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const visible = useMemo(() => notes.filter((note) => !note.deletedAt), [notes]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = keyword
      ? visible.filter((note) => note.body.toLowerCase().includes(keyword))
      : visible;
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [visible, query]);

  const streak = computeStreak(log, now);
  const reviews = totalReviews(log);
  const cells = buildHeatmap(log, 12, now);

  function doExport() {
    const blob = new Blob([buildExport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nicenotes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('已导出 JSON');
  }

  async function doImport(file: File) {
    try {
      const count = await importJson(await file.text());
      toast(count > 0 ? `导入 ${count} 条` : '文件里没有笔记', count > 0 ? 'ok' : 'warn');
    } catch {
      toast('这个文件读不了，需要之前导出的 JSON', 'error');
    }
  }

  return (
    <section className="library">
      <div className="search">
        <SearchIcon className="search-icon" />
        <input
          id="search-input"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜标题、搜正文里的任何一个字"
          spellCheck={false}
          aria-label="搜索笔记"
        />
        {query && (
          <button type="button" className="search-clear" onClick={() => setQuery('')}>
            清除
          </button>
        )}
      </div>

      <div className="lib-count">
        {query ? `找到 ${filtered.length} 条` : `全部 ${visible.length} 条`}
      </div>

      <ul className="note-list">
        {filtered.map((note) => {
          const { title } = splitBody(note.body);
          const fresh = isNew(note);
          return (
            <li key={note.id} className="note-row">
              <button type="button" className="note-main" onClick={() => onEdit(note)}>
                <span className="note-title">{title || '(空)'}</span>
                <span className="note-meta">
                  {fresh ? (
                    <em className="tag tag-new">新</em>
                  ) : (
                    <span>下次 {dueLabel(note.memory.due, now)}</span>
                  )}
                  <span className="dot-sep" />
                  <span>{pastLabel(note.createdAt, now)}记的</span>
                  {note.reviewCount > 0 && (
                    <>
                      <span className="dot-sep" />
                      <span>复习 {note.reviewCount} 次</span>
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="note-del"
                aria-label="删除"
                onClick={() => {
                  if (window.confirm('删掉这条？本地会立刻消失，同步后其它设备也会消失。')) onDelete(note.id);
                }}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>

      {filtered.length === 0 && (
        <p className="lib-empty">{query ? '没有匹配的笔记' : '还没有笔记，按 N 记一条'}</p>
      )}

      <div className="lib-foot">
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{streak}</span>
            <span className="stat-label">连续天数</span>
          </div>
          <div className="stat">
            <span className="stat-value">{reviews}</span>
            <span className="stat-label">累计复习</span>
          </div>
          <div className="stat">
            <span className="stat-value">{visible.length}</span>
            <span className="stat-label">笔记</span>
          </div>
        </div>

        <div className="heat" aria-label="最近 12 周的复习记录">
          {cells.map((cell) => {
            const level = cell.count === 0 ? 0 : cell.count < 3 ? 1 : cell.count < 6 ? 2 : 3;
            return (
              <span
                key={cell.ts}
                className={`heat-cell heat-${level} ${cell.future ? 'is-future' : ''}`}
                title={cell.count ? `${new Date(cell.ts).toLocaleDateString('zh-CN')} · ${cell.count} 次` : ''}
              />
            );
          })}
        </div>

        <div className="lib-actions">
          <button type="button" className="link" onClick={doExport}>
            导出 JSON
          </button>
          <span className="dot-sep" />
          <button type="button" className="link" onClick={() => fileRef.current?.click()}>
            导入
          </button>
          <span className="lib-hint">数据默认只在这台设备上</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void doImport(file);
              event.target.value = '';
            }}
          />
        </div>
      </div>
    </section>
  );
}
