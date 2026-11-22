import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayGroupLabel, dayKey, dueLabel, splitBody, todayStamp } from '../lib/date';
import { downloadText } from '../lib/download';
import { plainText } from '../lib/rich';
import { relatedNotes, searchNotes } from '../lib/search';
import { shuffle } from '../lib/shuffle';
import { buildMarkdown, archiveNote, archiveNotes, removeNotes, toast, unarchiveNotes } from '../store';
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
  /** 顺着内链跳转走过的路径，用来退回去 */
  const [backStack, setBackStack] = useState<string[]>([]);
  const openIdRef = useRef<string | null>(null);
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

  /** 上一次点的是哪条 —— Shift 连选从它开始算 */
  const anchorRef = useRef<string | null>(null);

  /**
   * 多选时点一条。按住 Shift 就从上一次点的那条连到这条一起选上。
   *
   * 顺序从 DOM 上读：分组、搜索、随机排序下「上下」的含义都不一样，
   * 而 DOM 里排的就是眼睛看到的顺序。
   */
  const handleSelect = useCallback(
    (id: string, event: { shiftKey: boolean }) => {
      const anchor = anchorRef.current;

      if (event.shiftKey && anchor && anchor !== id) {
        const order = [...document.querySelectorAll<HTMLElement>('.item')].map((el) =>
          el.id.replace(/^note-/, ''),
        );
        const from = order.indexOf(anchor);
        const to = order.indexOf(id);

        if (from !== -1 && to !== -1) {
          const start = Math.min(from, to);
          const end = Math.max(from, to);
          const range = order.slice(start, end + 1);
          setSelected((current) => new Set([...current, ...range]));
          return;
        }
      }

      toggleSelect(id);
      anchorRef.current = id;
    },
    [toggleSelect],
  );

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  // 多选时按 Esc 退出。App 那层的 Esc 只管搜索和设置，管不到这里。
  // 用捕获阶段并拦住冒泡：搜索 + 多选同时开着时，一次 Esc 只退最外面那层
  // （多选），不会顺带把搜索词也清掉。
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        exitSelect();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selectMode, exitSelect]);

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
  /**
   * 输入停顿一下再搜。
   *
   * 原来的做法是每敲一个键就重算一遍，中文用输入法时拼音还没选字，
   * 组合中的中间态会把列表刷得上下跳。停 220ms 再算，既贴合手速，
   * 也就不用去猜 composition 事件的时序。
   */
  const [searchTerm, setSearchTerm] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(query), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searching = searchTerm.trim().length > 0;

  const result = useMemo(
    () => (searching ? searchNotes(alive, searchTerm, now) : null),
    [alive, searchTerm, searching, now],
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
    const previous = openIdRef.current;
    // 从 A 跳到 B，得记住 A —— 顺着内链读下去之后要能退回来
    if (previous && previous !== id) setBackStack((stack) => [...stack, previous]);

    openIdRef.current = id;
    setOpenId(id);
    requestAnimationFrame(() => {
      document.getElementById(`note-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  function goBack(): void {
    const previous = backStack[backStack.length - 1];
    if (!previous) return;

    setBackStack((stack) => stack.slice(0, -1));
    openIdRef.current = previous;
    setOpenId(previous);
    requestAnimationFrame(() => {
      document.getElementById(`note-${previous}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

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

  /*
   * 搜索框里按回车：展开第一条并滚过去。
   *
   * 这里不走 jump —— 那个是顺着内链跳的逻辑，会往返回栈里压一层，
   * 顶部就会冒出「回到 xx」。从搜索直接看第一条不需要回头路。
   */
  useEffect(() => {
    if (!searching || !result || result.hits.length === 0) return;

    const onOpenFirst = () => {
      const first = result.hits[0]?.note;
      if (!first) return;
      openIdRef.current = first.id;
      setOpenId(first.id);
      setBackStack([]);
      requestAnimationFrame(() => {
        document.getElementById(`note-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };

    window.addEventListener('nicenotes:open-first-hit', onOpenFirst);
    return () => window.removeEventListener('nicenotes:open-first-hit', onOpenFirst);
  }, [result, searching]);

  function toggle(id: string) {
    const next = openId === id ? null : id;
    openIdRef.current = next;
    setOpenId(next);
    // 自己点开的条目，不算「顺着内链跳过来的」，清掉返回路径
    if (next) setBackStack([]);
  }

  const backNote =
    backStack.length > 0 ? alive.find((note) => note.id === backStack[backStack.length - 1]) : undefined;

  /**
   * 谁引用了我。
   *
   * 展开某条笔记时，扫一遍其他笔记的正文，看谁的 [[标题]] 指过来。
   * 同时只有一条展开，所以每次 O(n) 扫一遍就够，不用建索引。
   */
  const backlinks = useMemo(() => {
    if (!openId) return [];
    const target = alive.find((note) => note.id === openId);
    if (!target) return [];

    const title = plainText(splitBody(target.body).title).trim();
    if (!title) return [];

    const found: { id: string; title: string }[] = [];
    for (const note of alive) {
      if (note.id === openId) continue;
      for (const match of note.body.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
        if ((match[1] ?? '').trim() === title) {
          found.push({ id: note.id, title: plainText(splitBody(note.body).title) || '(空)' });
          break;
        }
      }
    }
    return found;
  }, [alive, openId]);

  /**
   * j / k 上下走。
   *
   * 列表长起来之后，一条一条点开看再点回去很累手。j 是下一条、k 是上一条，
   * 和 vim、less 一样 —— 用这个应用的人大概都按过。
   *
   * 多选模式下让位：那时候点整条是勾选，j/k 容易误操作。
   */
  useEffect(() => {
    if (selectMode) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'j' && event.key !== 'k') return;

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const list = streamed;
      if (list.length === 0) return;

      const index = list.findIndex((note) => note.id === openId);
      const step = event.key === 'j' ? 1 : -1;
      const nextIndex = index === -1 ? 0 : Math.min(list.length - 1, Math.max(0, index + step));
      const next = list[nextIndex];
      if (!next) return;

      event.preventDefault();
      jump(next.id);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [streamed, openId, selectMode, jump]);

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
      backlinks={openId === note.id ? backlinks : []}
      onJump={jump}
      selectMode={selectMode}
      selected={selected.has(note.id)}
      onSelect={(event) => handleSelect(note.id, event)}
      backTo={
        openId === note.id && backNote && backNote.id !== note.id
          ? { title: plainText(splitBody(backNote.body).title) || '刚才那条', onClick: goBack }
          : undefined
      }
    />
  );

  async function bulkArchive() {
    await archiveNotes([...selected]);
    exitSelect();
  }

  /** 把选中的几条单独导成一份 Markdown，发给别人或者贴到别处 */
  function bulkExport() {
    if (selected.size === 0) return;
    const text = buildMarkdown(new Set(selected));
    if (!text.trim()) {
      toast('选中的笔记没有内容', 'warn');
      return;
    }
    downloadText(text, `nicenotes-选中${selected.size}条-${todayStamp()}.md`, 'text/markdown;charset=utf-8');
    toast(`导出了 ${selected.size} 条`);
    exitSelect();
  }

  /** 归档错了要能成批救回来，一条条点「恢复复习」太慢 */
  async function bulkRestore() {
    await unarchiveNotes([...selected]);
    exitSelect();
  }

  async function bulkDelete() {
    await removeNotes([...selected]);
    exitSelect();
  }

  /**
   * 底部批量操作条。
   *
   * 抽成函数是因为搜索态和正常列表是两条渲染路径 —— 之前只有正常列表那
   * 一条带它，于是「进了多选、又去搜了一下」时整个操作条消失，看着像
   * 选择被取消了（其实状态还在，清空搜索又冒出来）。
   *
   * pool 是当前能看到的那些笔记：正常流里是全库，搜索时是命中项。
   * 「全选」只选眼前这些，不会把搜不到的一起吞掉。
   */
  function renderBulkBar(pool: StoredNote[]) {
    if (!selectMode) return null;

    const ids = pool.map((note) => note.id);
    const allPicked = ids.length > 0 && ids.every((id) => selected.has(id));
    /*
     * 选中状态是跨搜索保留的，但界面上只有一部分看得见。
     * 换了个搜索词之后可能一条选中的都不在眼前，底部却还写着「已选 2 条」——
     * 这时候按删除，删掉的是屏幕上一个都看不到的东西。说清楚差多少。
     */
    const hidden = selected.size - ids.filter((id) => selected.has(id)).length;

    return (
      <div className="bulk-bar">
        <span className="bulk-count">
          已选 {selected.size} 条
          {hidden > 0 && <span className="bulk-hidden">（{hidden} 条不在当前结果里）</span>}
        </span>

        <div className="bulk-actions">
          <button
            type="button"
            className="link"
            disabled={ids.length === 0}
            onClick={() => setSelected(allPicked ? new Set() : new Set(ids))}
          >
            {allPicked ? '取消全选' : '全选'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={selected.size === 0}
            onClick={bulkExport}
          >
            导出
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
            className="btn btn-ghost btn-sm"
            disabled={selected.size === 0}
            onClick={() => void bulkRestore()}
          >
            恢复
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
    );
  }

  if (searching && result) {
    const count = result.hits.length;

    return (
      <div className={`stream is-searching ${selectMode ? 'is-selecting' : ''}`}>
        <div className="stream-bar">
          <span>
            按关联度排序
            <span className="dot-sep" />
            {count > 0 ? `${count} 条` : '没有匹配'}
            {/*
             * 拼音命中在正文里标不出来（ytw 和「以太网」没有共同字符），
             * 不说一句的话，一条没高亮的结果看着像搜错了。
             */}
            {result.usedPinyin && (
              <>
                <span className="dot-sep" />
                <span className="search-pinyin-hint">含拼音首字母匹配</span>
              </>
            )}
          </span>
          <div className="stream-tools">
            {/*
             * 搜出来的结果也要能批量处理。之前这个入口只在正常列表里有，
             * 想删掉搜出来的几条，得先清空搜索、进多选、再搜回去。
             */}
            {count > 0 && (
              <button
                type="button"
                className="stream-select"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                {selectMode ? '取消' : '选择'}
              </button>
            )}
            <button type="button" className="link" onClick={onClearQuery}>
              清除
            </button>
          </div>
        </div>

        {count === 0 ? (
          <div className="no-result">
            <SearchIcon size={22} />
            <p className="no-result-title">没有找到「{searchTerm.trim()}」</p>
            <p className="no-result-hint">
              是按字和词的相关度找的，不要求整句一模一样。换个说法、或者少打几个字试试；也可以打拼音首字母，比如 ytw。
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
                backlinks={openId === hit.note.id ? backlinks : []}
                onJump={jump}
                selectMode={selectMode}
                selected={selected.has(hit.note.id)}
                onSelect={(event) => handleSelect(hit.note.id, event)}
              />
            ))}
          </ul>
        )}

        {renderBulkBar(result.hits.map((hit) => hit.note))}
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
          <PeekCard note={peek} onEdit={() => onEdit(peek)} nextAt={nextAt} />
        </div>
      ) : (
        <div className="rest">
          <span className="rest-line" />
          <span className="rest-text">
            {alive.length === 0
              ? '还是空的。按 N 记一条，写一句它就出现在这里。'
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

      {renderBulkBar(streamed)}
    </div>
  );
}
