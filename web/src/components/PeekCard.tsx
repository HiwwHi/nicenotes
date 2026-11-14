import { pastLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import type { StoredNote } from '../types';
import { PencilIcon } from './Icons';
import { Rich } from './Rich';

interface Props {
  note: StoredNote;
  onEdit: () => void;
}

/**
 * 今天没有要复习的时候，把最近记的一条顶上来。
 * 目的很简单：不管什么时候打开，第一屏都得有一条笔记，而不是一个列表。
 */
export function PeekCard({ note, onEdit }: Props) {
  const now = Date.now();
  const { title, rest } = splitBody(note.body);

  return (
    <article className="card">
      <div className="review-meta">
        <span className="review-meta-text">随手翻到 · {pastLabel(note.createdAt, now)}记的</span>
      </div>

      <h1 className="card-title">{plainText(title)}</h1>
      {rest && (
        <div className="card-rest">
          <Rich text={rest} />
        </div>
      )}

      <div className="review-foot">
        <button type="button" className="link" onClick={onEdit}>
          <PencilIcon />
          改一下
        </button>
      </div>
    </article>
  );
}
