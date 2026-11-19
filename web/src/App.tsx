import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, CloseIcon, PlusIcon, SearchIcon, SettingsIcon } from './components/Icons';
import { Composer } from './components/Composer';
import { Settings } from './components/Settings';
import { Stream } from './components/Stream';
import { dayKey } from './lib/date';
import { isNew } from './lib/scheduler';
import { applyTheme, readTheme, type Theme } from './lib/theme';
import {
  addNote,
  dismissToast,
  editNote,
  grade,
  init,
  nextSoonest,
  removeNote,
  reveal,
  skip,
  syncNow,
  useApp,
} from './store';
import { clearSearches, readSearches, rememberSearch, writeSearches } from './lib/history';
import type { Grade } from './types';

type View = 'stream' | 'settings';

interface ComposerState {
  mode: 'create' | 'edit';
  noteId?: string;
  initial: string;
}

export default function App() {
  const app = useApp();
  const [view, setView] = useState<View>('stream');
  /** 输入框里显示的内容。中文输入法拼写期间也要实时更新，否则看不到自己打的字 */
  const [query, setQuery] = useState('');
  /**
   * 真正拿去搜的词。
   *
   * 和 query 分开：输入法还在拼的时候 query 是「wanggu」，这时候按它搜会先
   * 按拼音缩跑去匹配一轮，选完词再跳一次 —— 结果闪两下，第一轮还可能是错的。
   * 组合期间不动它，列表就停在上一轮结果上。
   */
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [searches, setSearches] = useState<string[]>(() => readSearches());
  const [historyOpen, setHistoryOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // 停手一秒半才记进历史：打到一半的词不该出现在「最近搜过」里
  useEffect(() => {
    if (!searchTerm.trim()) return;
    const timer = window.setTimeout(() => {
      setSearches((current) => rememberSearch(current, searchTerm));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  // 点别处收起历史
  useEffect(() => {
    if (!historyOpen) return;
    function onDown(event: MouseEvent) {
      if (!searchBoxRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [historyOpen]);

  function pickSearch(text: string) {
    setQuery(text);
    setHistoryOpen(false);
    searchRef.current?.focus();
  }

  function forgetSearch(text: string) {
    setSearches((current) => {
      const next = current.filter((item) => item !== text);
      writeSearches(next);
      return next;
    });
  }

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    void init();
  }, []);

  useEffect(() => {
    if (app.ready) document.getElementById('boot')?.remove();
  }, [app.ready]);

  const current = app.currentId ? app.notes.find((note) => note.id === app.currentId) : undefined;
  const review = current ? { note: current, kind: isNew(current) ? ('new' as const) : ('due' as const) } : null;
  const nextAt = nextSoonest();

  /**
   * 弹窗关掉之后把焦点还给当初触发它的那个元素。
   *
   * 不还的话焦点落回 body，接着按 Tab 要从页面最开头重新找 —— 用键盘的人
   * 会丢掉位置。跳过去之前先记一下，回来才认得路。
   */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = useCallback(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);

  const openCreate = useCallback(() => {
    rememberFocus();
    setComposer({ mode: 'create', initial: '' });
  }, [rememberFocus]);

  const openEdit = useCallback(
    (noteId: string, body: string) => {
      rememberFocus();
      setComposer({ mode: 'edit', noteId, initial: body });
    },
    [rememberFocus],
  );

  const closeComposer = useCallback(() => {
    setComposer(null);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    // 等 React 把弹窗摘下来再聚焦，否则焦点会被卸载中的节点吃掉
    if (!back) return;
    requestAnimationFrame(() => {
      if (document.contains(back)) back.focus();
    });
  }, []);

  const focusSearch = useCallback(() => {
    setView('stream');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const onGrade = useCallback((value: Grade) => {
    if (!app.currentId) return;
    void grade(app.currentId, value);
  }, [app.currentId]);

  /**
   * 应用快捷方式：长按桌面图标选「记一条」/「搜索」。
   *
   * 带参数进来后先把地址栏还原，否则刷新一次又自动开一遍编辑器。
   * 等 ready 之后再执行 —— 初始化没完成就开弹窗，焦点会落到空地址上。
   */
  useEffect(() => {
    if (!app.ready) return;

    const params = new URLSearchParams(window.location.search);
    const wantsNew = params.get('new') === '1';
    const wantsSearch = params.get('search') === '1';
    if (!wantsNew && !wantsSearch) return;

    params.delete('new');
    params.delete('search');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);

    if (wantsNew) openCreate();
    else focusSearch();
  }, [app.ready, focusSearch, openCreate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (composer) return;
      // 输入法组合期间的按键属于输入法，别拿来做快捷键
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      /*
       * Ctrl/Cmd+K 打开搜索。大半软件都是这个组合，手比脑子快；
       * 单独一个 / 也还留着，两个都能进。
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        if (query) {
          setQuery('');
          setSearchTerm('');
          searchRef.current?.blur();
          return;
        }
        if (view === 'settings') setView('stream');
        return;
      }

      if (typing) return;

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        openCreate();
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (view !== 'stream' || query || !current) return;

      if (event.key === ' ') {
        event.preventDefault();
        if (!app.revealed) reveal();
        return;
      }

      if (event.key === '1' || event.key === '2' || event.key === '3') {
        event.preventDefault();
        void grade(current.id, (Number(event.key) - 1) as Grade);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.revealed, composer, current, focusSearch, historyOpen, openCreate, query, view]);

  if (app.fatal) {
    return (
      <div className="fatal">
        <h1>打不开本地数据库</h1>
        <p>{app.fatal}</p>
        <p className="fatal-hint">如果用无痕窗口，换普通窗口试试；如果开了多个标签页，关掉多余的再刷新。</p>
      </div>
    );
  }

  if (!app.ready) return <div className="booting" />;

  const todayKey = dayKey(Date.now());

  return (
    <div className="app">
      <header className="top">
        <button
          type="button"
          className="brand"
          onClick={() => {
            setView('stream');
            setQuery('');
          }}
          title="回到最先的那条"
        >
          <span className="brand-dot" aria-hidden="true" />
          <span className="brand-name">NiceNotes</span>
        </button>

        {view === 'stream' ? (
          <div className="searchbox" ref={searchBoxRef}>
            <div className={`searchbar ${query ? 'has-value' : ''}`}>
              <SearchIcon className="searchbar-icon" />
              <input
                ref={searchRef}
                id="search-input"
                className="searchbar-input"
                value={query}
                onChange={(event) => {
                  const next = event.target.value;
                  setQuery(next);
                  setHistoryOpen(false);
                  // 组合期间只更新显示，不拿去搜
                  if (!(event.nativeEvent as InputEvent).isComposing) setSearchTerm(next);
                }}
                onCompositionEnd={(event) => {
                  setSearchTerm(event.currentTarget.value);
                  setHistoryOpen(false);
                }}
                onFocus={() => {
                  if (!query && searches.length > 0) setHistoryOpen(true);
                }}
                // 已经聚焦时再点一下不会再触发 focus，所以 click 也要管
                onClick={() => {
                  if (!query && searches.length > 0) setHistoryOpen(true);
                }}
                placeholder="搜笔记，汉字或拼音首字母"
                spellCheck={false}
                aria-label="搜索笔记"
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  // 搜完按回车直接看第一条，不用再拿鼠标去点
                  event.preventDefault();
                  window.dispatchEvent(new CustomEvent('nicenotes:open-first-hit'));
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="searchbar-clear"
                  aria-label="清除搜索"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  <CloseIcon size={14} />
                </button>
              ) : (
                <kbd className="searchbar-key">/</kbd>
              )}
            </div>

            {historyOpen && !query && searches.length > 0 && (
              <div className="search-history">
                <div className="search-history-head">
                  <span>最近搜过</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearSearches();
                      setSearches([]);
                      setHistoryOpen(false);
                    }}
                  >
                    清空
                  </button>
                </div>
                <ul>
                  {searches.map((item) => (
                    <li key={item}>
                      <button type="button" className="history-pick" onClick={() => pickSearch(item)}>
                        {item}
                      </button>
                      <button
                        type="button"
                        className="history-remove"
                        aria-label={`从历史里删掉「${item}」`}
                        onClick={() => forgetSearch(item)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="top-title">
            <button type="button" className="link" onClick={() => setView('stream')}>
              <ArrowLeftIcon size={14} />
              回到笔记
            </button>
            <span className="top-title-text">设置</span>
          </div>
        )}

        <div className="top-actions">
          {app.account && (
            <button
              type="button"
              className={`sync-dot ${app.syncing ? 'is-busy' : ''} ${app.syncError ? 'is-error' : ''}`}
              title={app.syncError ?? (app.syncing ? '同步中' : '已连接，点一下立即同步')}
              aria-label="同步状态"
              onClick={() => void syncNow()}
            />
          )}

          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <PlusIcon size={15} />
            <span>记一条</span>
          </button>

          <button
            type="button"
            className={`icon-btn ${view === 'settings' ? 'is-active' : ''}`}
            aria-label="设置"
            title="设置"
            onClick={() => setView(view === 'settings' ? 'stream' : 'settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {/*
       * 断了网也得让人心里有数：笔记都还在，只是还没传上去。只给那一颗小
       * 圆点变个色，多数人根本不会注意到。
       */}
      {app.account && !app.online && (
        <div className="offline-bar" role="status">
          <span className="offline-dot" aria-hidden="true" />
          现在没有网络 · 笔记都存在这台设备上，联网后自动同步
        </div>
      )}

      <main className="main">
        {view === 'stream' ? (
          <Stream
            notes={app.notes}
            review={review}
            revealed={app.revealed}
            reviewedToday={app.log[todayKey] ?? 0}
            query={searchTerm}
            nextAt={nextAt}
            onReveal={reveal}
            onGrade={onGrade}
            onSkip={skip}
            onEdit={(note) => openEdit(note.id, note.body)}
            onDelete={(id) => void removeNote(id)}
            onClearQuery={() => setQuery('')}
          />
        ) : (
          <Settings theme={theme} onTheme={setTheme} />
        )}
      </main>

      {composer && (
        <Composer
          mode={composer.mode}
          initial={composer.initial}
          noteId={composer.noteId}
          onClose={closeComposer}
          onSubmit={async (text) => {
            if (composer.mode === 'create') {
              const ok = await addNote(text);
              if (ok) {
                setQuery('');
                setView('stream');
                // 新笔记排在最上面。滚回去让它自己露个脸，
                // 不然你刚写完却看不到，会怀疑到底存没存下
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
              return ok;
            }
            // 改失败（比如这条在别处被删了）就别关弹窗，内容还在里面
            if (composer.noteId) return await editNote(composer.noteId, text);
            return true;
          }}
        />
      )}

      {app.toast && (
        <div className={`toast toast-${app.toast.tone}`} key={app.toast.id} role="status">
          <span className="toast-text">{app.toast.text}</span>
          {app.toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const run = app.toast?.action?.run;
                dismissToast();
                run?.();
              }}
            >
              {app.toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
