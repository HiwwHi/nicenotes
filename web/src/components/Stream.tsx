import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayGroupLabel, dayKey, dueLabel, splitBody } from '../lib/date';
import { plainText } from '../lib/rich';
import { relatedNotes, searchNotes } from '../lib/search';
import { shuffle } from '../lib/shuffle';
import { archiveNote, archiveNotes, removeNotes, toast } from '../store';
import type { Grade, StoredNote } from '../types';
import { SearchIcon } from './Icons';
import { NoteItem } from './NoteItem';
import { PeekCard } from './PeekCard';
import { ReviewCard } from './ReviewCard';

/** 浏览顺序：按时间，还是打散 */
type Order = 'time' | 'random';
const ORDER_KEY = 'nicenotes.order';

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

  /**
   * 浏览顺序。
   *   time   —— 按写作时间，像一份不断往下追加的 Markdown 文件
   *   random —— 打散了看，每次点一下换一批，适合翻着复习
   * 选择记在本地，下次打开还是你上次选的那个。
   */
  const [order, setOrder] = useState<Order>(() => {
    try {
      return localStorage.getItem(ORDER_KEY) === 'random' ? 'random' : 'time';
    } catch {
      return 'time';
    }
  });
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));

  /** 多选：整理导入进来的一批笔记时，逐条点太慢 */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const changeOrder = useCallback((next: Order) => {
    setOrder(next);
    // 每次点「随机」都换一个 seed，等于重新洗一遍牌
    if (next === 'random') setSeed(Math.floor(Math.random() * 1_000_000_000));
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      /* 无痕模式写不进去，忽略 */
    }
  }, []);

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
    if (review) return null;

    const pool = alive.filter((note) => !note.archivedAt);
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0] ?? null;

    const day = 86_400_000;
    const weights = pool.map((note) => {
      const touched = Math.max(note.updatedAt, note.createdAt);
      return 1 + Math.min(30, Math.max(0, (now - touched) / day));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return pool[i] ?? null;
    }
    return pool[pool.length - 1] ?? null;
  }, [review, alive, now]);

  /** 第一屏那张已经在最显眼的位置了，流里不再出现第二次 */
  const heroId = review?.note.id ?? peek?.id;

  const streamed = useMemo(() => {
    const rest = alive.filter((note) => note.id !== heroId);
    if (order === 'random') return shuffle(rest, seed);
    return rest.sort((a, b) => b.createdAt - a.createdAt);
  }, [alive, heroId, order, seed]);

  const groups = useMemo(() => {
    // 随机模式不按天分组：打散的意思就是不按时间走
    if (order === 'random') return [];

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
  }, [streamed, order, now]);

  /** 全库还是示例笔记 —— 这时候该给一句说明，不然第一次打开不知道能干什么 */
  const demoOnly = useMemo(
    () => alive.length > 0 && alive.every((note) => note.origin === 'demo'),
    [alive],
  );

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

  const renderNote = (note: StoredNote) => (
    <NoteItem
      key={note.id}
      note={note}
      marks={[]}
      expanded={openId === note.id}
      onToggle={() => toggle(note.id)}
      onEdit={() => onEdit(note)}
      onDelete={() => onDelete(note.id)}
      onArchive={() => void archiveNote(note.id)}
      related={openId === note.id ? relatedHits : []}
      onJump={jump}
      selectMode={selectMode}
      selected={selected.has(note.id)}
      onSelect={() => toggleSelect(note.id)}
    />
  );

  async function bulkArchive() {
    await archiveNotes([...selected]);
    exitSelect();
  }

  async function bulkDelete() {
    await removeNotes([...selected]);
    exitSelect();
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
                onArchive={() => void archiveNote(hit.note.id)}
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
    <div className={`stream ${selectMode ? 'is-selecting' : ''}`}>
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

      {demoOnly && (
        <p className="intro">
          这些是示例，随便改、随便删。按 <kbd>N</kbd> 记一条你自己的，按 <kbd>/</kbd> 搜任何词。
        </p>
      )}

      {streamed.length > 0 && (
        <>
          <div className="stream-bar stream-bar-quiet">
            <span className="stream-title">
              全部笔记
              <span className="dot-sep" />
              {alive.length} 条
            </span>

            <div className="stream-tools">
              <div className="order-switch" role="group" aria-label="浏览顺序">
                <button
                  type="button"
                  className={order === 'time' ? 'is-active' : ''}
                  onClick={() => changeOrder('time')}
                  title="按写作时间，像一份不断往下追加的文件"
                >
                  按时间
                </button>
                <button
                  type="button"
                  className={order === 'random' ? 'is-active' : ''}
                  onClick={() => changeOrder('random')}
                  title="打散了看，再点一下换一批"
                >
                  随机
                </button>
              </div>

              <button
                type="button"
                className="stream-select"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                {selectMode ? '取消' : '选择'}
              </button>
            </div>
          </div>

          {order === 'random' ? (
            <ul className="timeline is-flat">{streamed.map(renderNote)}</ul>
          ) : (
            <ul className="timeline">
              {groups.map((group) => (
                <li key={group.label} className="day">
                  <h2 className="day-label">{group.label}</h2>
                  <ul>{group.notes.map(renderNote)}</ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selectMode && (
        <div className="bulk-bar">
          <span className="bulk-count">已选 {selected.size} 条</span>

          <div className="bulk-actions">
            <button
              type="button"
              className="link"
              onClick={() =>
                setSelected(
                  selected.size === streamed.length
                    ? new Set()
                    : new Set(streamed.map((note) => note.id)),
                )
              }
            >
              {selected.size === streamed.length && streamed.length > 0 ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={selected.size === 0}
              onClick={() => void bulkArchive()}
            >
              归档
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm link-danger"
              disabled={selected.size === 0}
              onClick={() => void bulkDelete()}
            >
              删除
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exitSelect}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
