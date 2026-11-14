import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayGroupLabel, dayKey, dueLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import { relatedNotes, searchNotes } from '../lib/search';
import { toast } from '../store';
import type { Grade, StoredNote } from '../types';
import { SearchIcon } from './Icons';
import { NoteItem } from './NoteItem';
import { PeekCard } from './PeekCard';
import { ReviewCard } from './ReviewCard';

interface Props {
  notes: StoredNote[];
  review: { note: StoredNote; kind: 'due' | 'new' } | null;
  revealed: boolean;
  reviewedToday: number;
  query: string;
  nextAt: number | null;
  onReveal: () => void;
  onGrade: (grade: Grade) => void;
  onSkip: () => void;
  onEdit: (note: StoredNote) => void;
  onDelete: (id: string) => void;
  onClearQuery: () => void;
}

export function Stream({
  notes,
  review,
  revealed,
  reviewedToday,
  query,
  nextAt,
  onReveal,
  onGrade,
  onSkip,
  onEdit,
  onDelete,
  onClearQuery,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 固定在这一刻：流的分组和「多久以前」不需要秒级刷新
  const [now] = useState(() => Date.now());

  const alive = useMemo(() => notes.filter((note) => !note.deletedAt), [notes]);
  const searching = query.trim().length > 0;

  const result = useMemo(
    () => (searching ? searchNotes(alive, query, now) : null),
    [alive, query, searching, now],
  );

  /**
   * 今天没有到期的时候，从全部笔记里加权抽一条顶上第一屏。
   *
   * 抽而不是取最新：目标是你打开就被一条笔记「撞见」，不是每次都看到同一条。
   * 权重按「多久没碰过」算，越久越容易被抽中 —— 跟你原来那版加权选题是同一个道理。
   */
  const peek = useMemo(() => {
    if (review || alive.length === 0) return null;
    if (alive.length === 1) return alive[0] ?? null;

    const day = 86_400_000;
    const weights = alive.map((note) => {
      const touched = Math.max(note.updatedAt, note.createdAt);
      return 1 + Math.min(30, Math.max(0, (now - touched) / day));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let roll = Math.random() * total;
    for (let i = 0; i < alive.length; i += 1) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return alive[i] ?? null;
    }
    return alive[alive.length - 1] ?? null;
  }, [review, alive, now]);

  /** 第一屏那张已经在最显眼的位置了，流里不再出现第二次 */
  const heroId = review?.note.id ?? peek?.id;

  const streamed = useMemo(
    () => alive.filter((note) => note.id !== heroId).sort((a, b) => b.createdAt - a.createdAt),
    [alive, heroId],
  );

  const groups = useMemo(() => {
    const buckets = new Map<string, { label: string; notes: StoredNote[] }>();
    for (const note of streamed) {
      const key = dayKey(note.createdAt);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.notes.push(note);
      } else {
        buckets.set(key, { label: dayGroupLabel(note.createdAt, now), notes: [note] });
      }
    }
    return [...buckets.values()];
  }, [streamed, now]);

  const relatedHits = useMemo(() => {
    if (!openId) return [];
    const note = alive.find((item) => item.id === openId);
    return note ? relatedNotes(note, alive) : [];
  }, [openId, alive]);

  const jump = useCallback((id: string) => {
    setOpenId(id);
    requestAnimationFrame(() => {
      document.getElementById(`note-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  /** 正文里点了 [[某条笔记]] 就跳过去；找不到就说一声，不装作没发生 */
  useEffect(() => {
    function onOpen(event: Event) {
      const wanted = (event as CustomEvent<{ title?: string }>).detail?.title?.trim();
      if (!wanted) return;

      const heading = (note: StoredNote) => plainText(splitBody(note.body).title);
      const target =
        alive.find((note) => heading(note) === wanted) ??
        alive.find((note) => heading(note).includes(wanted));

      if (!target) {
        toast(`没有找到「${wanted}」`, 'warn');
        return;
      }

      // 第一屏那张卡片不在流里，滚回顶部就是它
      if (target.id === heroId) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (searching) onClearQuery();
      window.setTimeout(() => jump(target.id), searching ? 140 : 0);
    }

    window.addEventListener('nicenotes:open-note', onOpen);
    return () => window.removeEventListener('nicenotes:open-note', onOpen);
  }, [alive, heroId, jump, onClearQuery, searching]);

  function toggle(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  if (searching && result) {
    const count = result.hits.length;

    return (
      <div className="stream is-searching">
        <div className="stream-bar">
          <span>
            按关联度排序
            <span className="dot-sep" />
            {count > 0 ? `${count} 条` : '没有匹配'}
          </span>
          <button type="button" className="link" onClick={onClearQuery}>
            清除
          </button>
        </div>

        {count === 0 ? (
          <div className="no-result">
            <SearchIcon size={22} />
            <p className="no-result-title">没有找到「{query.trim()}」</p>
            <p className="no-result-hint">
              是按字和词的相关度找的，不要求整句一模一样。换个说法、或者少打几个字试试。
            </p>
          </div>
        ) : (
          <ul className="timeline is-flat">
            {result.hits.map((hit) => (
              <NoteItem
                key={hit.note.id}
                note={hit.note}
                marks={result.marks}
                score={hit.score}
                expanded={openId === hit.note.id}
                onToggle={() => toggle(hit.note.id)}
                onEdit={() => onEdit(hit.note)}
                onDelete={() => onDelete(hit.note.id)}
                related={openId === hit.note.id ? relatedHits : []}
                onJump={jump}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="stream">
      {review ? (
        <div className="lead">
          <span className="lead-tag">{review.kind === 'new' ? '第一次见' : '该回来看看了'}</span>
          <ReviewCard
            note={review.note}
            kind={review.kind}
            revealed={revealed}
            reviewedToday={reviewedToday}
            onReveal={onReveal}
            onGrade={onGrade}
            onEdit={() => onEdit(review.note)}
            onSkip={onSkip}
          />
        </div>
      ) : peek ? (
        <div className="lead">
          <PeekCard note={peek} onEdit={() => onEdit(peek)} />
        </div>
      ) : (
        <div className="rest">
          <span className="rest-line" />
          <span className="rest-text">
            {alive.length === 0
              ? '还是空的。写一句，它就会出现在这里。'
              : `今天的都看完了${nextAt ? `，下一次是${dueLabel(nextAt, now)}` : ''}`}
          </span>
          <span className="rest-line" />
        </div>
      )}

      {groups.length > 0 && (
        <>
          <div className="stream-bar stream-bar-quiet">
            <span className="stream-title">全部笔记</span>
            <span className="stream-hint">
              {alive.length} 条 · N 记一条 · / 搜索
            </span>
          </div>

          <ul className="timeline">
            {groups.map((group) => (
              <li key={group.label} className="day">
                <h2 className="day-label">{group.label}</h2>
                <ul>
                  {group.notes.map((note) => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      marks={[]}
                      expanded={openId === note.id}
                      onToggle={() => toggle(note.id)}
                      onEdit={() => onEdit(note)}
                      onDelete={() => onDelete(note.id)}
                      related={openId === note.id ? relatedHits : []}
                      onJump={jump}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
