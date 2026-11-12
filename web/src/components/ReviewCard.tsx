import { dueLabel, pastLabel, splitBody } from '../lib/date';
import { GRADE_META, nextDue } from '../lib/scheduler';
import type { Grade, Note } from '../types';

interface Props {
  note: Note;
  kind: 'due' | 'new';
  revealed: boolean;
  onReveal: () => void;
  onGrade: (grade: Grade) => void;
  onEdit: () => void;
  onSkip: () => void;
  reviewedToday: number;
}

export function ReviewCard({ note, kind, revealed, onReveal, onGrade, onEdit, onSkip, reviewedToday }: Props) {
  const now = Date.now();
  const { title, rest } = splitBody(note.body);
  const needsReveal = rest.length > 0;
  const shown = revealed || !needsReveal;

  const meta =
    kind === 'new'
      ? `新笔记 · 记于 ${pastLabel(note.createdAt, now)}`
      : `第 ${note.reviewCount} 次复习 · 上次 ${pastLabel(note.memory.lastReviewedAt ?? note.createdAt, now)}`;

  const overdueDays = kind === 'due' ? Math.floor((now - note.memory.due) / 86_400_000) : 0;

  return (
    <section className="review" aria-label="正在复习的笔记">
      <div className="review-meta">
        <span className="review-meta-text">{meta}</span>
        {overdueDays >= 1 && <span className="chip chip-warm">逾期 {overdueDays} 天</span>}
        <span className="review-count">{reviewedToday > 0 ? `今天已复习 ${reviewedToday} 条` : ''}</span>
      </div>

      <article className={`card ${shown ? 'is-shown' : ''}`}>
        <h1 className="card-title">{title}</h1>

        {needsReveal &&
          (revealed ? (
            <div className="card-rest">{rest}</div>
          ) : (
            <div className="card-veil" aria-hidden="true">
              <p>{rest}</p>
              <div className="card-veil-fade" />
            </div>
          ))}

        {!shown && (
          <button type="button" className="reveal-btn" onClick={onReveal}>
            想不起来，看内容
            <kbd>空格</kbd>
          </button>
        )}
      </article>

      {shown ? (
        <div className="grades">
          {GRADE_META.map((item) => (
            <button
              key={item.grade}
              type="button"
              className={`grade grade-${item.tone}`}
              onClick={() => onGrade(item.grade)}
            >
              <span className="grade-label">{item.label}</span>
              <span className="grade-hint">{dueLabel(nextDue(note.memory, item.grade, now), now)}</span>
              <span className="grade-key">{item.key}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="review-foot">
        <button type="button" className="link" onClick={onEdit}>
          改一下
        </button>
        <span className="dot-sep" />
        <button type="button" className="link" onClick={onSkip}>
          这条先跳过
        </button>
      </div>
    </section>
  );
}
