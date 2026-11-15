import { useEffect } from 'react';
import { dueLabel, pastLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import { isNew } from '../lib/scheduler';
import { snippet, type SearchHit } from '../lib/search';
import type { StoredNote } from '../types';
import { ArrowLeftIcon, CheckIcon, LinkIcon, PencilIcon, TrashIcon } from './Icons';
import { Marked, Rich } from './Rich';

interface Props {
  note: StoredNote;
  /** 搜索命中的单元，用来标亮 */
  marks: string[];
  /** 关联度百分比；只在搜索态显示 */
  score?: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  related: SearchHit[];
  onJump: (id: string) => void;
  /** 正在复习的那条，流里标一下 */
  featured?: boolean;
  /** 多选模式：点整条是勾选，不是展开 */
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** 顺着内链跳过来时，指向来处，让用户能退回去 */
  backTo?: { title: string; onClick: () => void };
}

export function NoteItem({
  note,
  marks,
  score,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onArchive,
  related,
  onJump,
  featured,
  selectMode,
  selected,
  onSelect,
  backTo,
}: Props) {
  const now = Date.now();
  const { title, rest } = splitBody(note.body);
  const heading = plainText(title);
  // 搜索时预览从命中处截，不然你看到的一行跟搜索词毫无关系
  const flat = plainText(rest);
  const preview = marks.length > 0 ? snippet(flat, marks) : flat;

  // 展开后把第一个命中滚进视野 —— 长笔记里命中常常在几十行之后
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      const root = document.getElementById(`note-${note.id}`);
      root?.querySelector('mark.hit')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, note.id]);

  return (
    <li id={`note-${note.id}`} className={`item ${expanded && !selectMode ? 'is-open' : ''} ${featured ? 'is-featured' : ''} ${selected ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="item-head"
        onClick={selectMode ? onSelect : onToggle}
        aria-expanded={selectMode ? undefined : expanded}
        aria-pressed={selectMode ? Boolean(selected) : undefined}
      >
        {selectMode ? (
          <span className={`item-check ${selected ? 'is-on' : ''}`} aria-hidden="true">
            {selected && <CheckIcon size={11} />}
          </span>
        ) : (
          <span className="item-dot" aria-hidden="true" />
        )}

        <span className="item-text">
          <span className="item-title">
            <Marked text={heading || '(空)'} marks={marks} />
          </span>

          {preview && (
            <span className="item-preview">
              <Marked text={preview} marks={marks} />
            </span>
          )}

          <span className="item-meta">
            <span>{pastLabel(note.createdAt, now)}</span>
            {note.reviewCount > 0 && (
              <>
                <span className="dot-sep" />
                <span>复习 {note.reviewCount} 次</span>
              </>
            )}
            {note.archivedAt ? (
              <>
                <span className="dot-sep" />
                <span className="item-archived">已归档</span>
              </>
            ) : (
              !expanded && (
                <>
                  <span className="dot-sep" />
                  <span className="item-due">
                    {isNew(note) ? '还没看过' : `下次 ${dueLabel(note.memory.due, now)}`}
                  </span>
                </>
              )
            )}
          </span>
        </span>

        {typeof score === 'number' && (
          <span className="item-score" title="和搜索词的相关度">
            {score}%
          </span>
        )}
      </button>

      {expanded && (
        <div className="item-open">
          {backTo && (
            <button type="button" className="back-link" onClick={backTo.onClick}>
              <ArrowLeftIcon size={13} />
              回到「{backTo.title}」
            </button>
          )}

          {rest && (
            <div className="item-body">
              <Rich text={rest} marks={marks} />
            </div>
          )}

          {related.length > 0 && (
            <div className="item-related">
              <span className="item-related-label">
                <LinkIcon />
                讲得相近的
              </span>
              <ul>
                {related.map((hit) => {
                  const other = plainText(splitBody(hit.note.body).title);
                  return (
                    <li key={hit.note.id}>
                      <button type="button" onClick={() => onJump(hit.note.id)}>
                        <span className="item-related-text">{other || '(空)'}</span>
                        <span className="item-related-score">{hit.score}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="item-actions">
            <button type="button" className="link" onClick={onEdit}>
              <PencilIcon />
              改一下
            </button>
            <span className="dot-sep" />
            <button type="button" className="link" onClick={onArchive}>
              {note.archivedAt ? '恢复复习' : '不再复习'}
            </button>
            <span className="dot-sep" />
            <button
              type="button"
              className="link link-danger"
              onClick={onDelete}
            >
              <TrashIcon />
              删除
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
