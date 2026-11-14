import { dueLabel, pastLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import { isNew } from '../lib/scheduler';
import type { SearchHit } from '../lib/search';
import type { StoredNote } from '../types';
import { LinkIcon, PencilIcon, TrashIcon } from './Icons';
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
}: Props) {
  const now = Date.now();
  const { title, rest } = splitBody(note.body);
  const heading = plainText(title);
  const preview = plainText(rest);

  return (
    <li id={`note-${note.id}`} className={`item ${expanded ? 'is-open' : ''} ${featured ? 'is-featured' : ''}`}>
      <button type="button" className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="item-dot" aria-hidden="true" />

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
