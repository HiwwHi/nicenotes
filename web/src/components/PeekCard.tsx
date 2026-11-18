import { dueLabel, pastLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import type { StoredNote } from '../types';
import { PencilIcon } from './Icons';
import { Rich } from './Rich';

interface Props {
  note: StoredNote;
  onEdit: () => void;
  /** 下一条到期的时间。没有就传 null */
  nextAt?: number | null;
}

/**
 * 今天没有要复习的时候，把最近记的一条顶上来。
 * 目的很简单：不管什么时候打开，第一屏都得有一条笔记，而不是一个列表。
 */
export function PeekCard({ note, onEdit, nextAt = null }: Props) {
  const now = Date.now();
  const { title, rest } = splitBody(note.body);

  return (
    <article className="card">
      <div className="review-meta">
        {/*
         * 这张卡出现在「今天没有要复习的」时候，得说清楚，顺便告诉下一次
         * 什么时候 —— 否则用户只看到一条随手翻到的笔记，不知道复习进度。
         * 以前这句写在下方的兜底文案里，但只要有笔记这张卡就会占位，
         * 那段文案等于永远不会显示。
         */}
        <span className="review-meta-text">
          今天的都看完了
          {nextAt ? `（下一次 ${dueLabel(nextAt, now)}）` : ''}
          <span className="dot-sep" />
          随手翻到 {pastLabel(note.createdAt, now)}记的一条
        </span>
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
