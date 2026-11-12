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
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const openCreate = useCallback(() => setComposer({ mode: 'create', initial: '' }), []);

  const openEdit = useCallback((noteId: string, body: string) => {
    setComposer({ mode: 'edit', noteId, initial: body });
  }, []);

  const focusSearch = useCallback(() => {
    setView('stream');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const onGrade = useCallback((value: Grade) => {
    if (!app.currentId) return;
    void grade(app.currentId, value);
  }, [app.currentId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (composer) return;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        if (query) {
          setQuery('');
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
  }, [app.revealed, composer, current, focusSearch, openCreate, query, view]);

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
          <div className={`searchbar ${query ? 'has-value' : ''}`}>
            <SearchIcon className="searchbar-icon" />
            <input
              ref={searchRef}
              id="search-input"
              className="searchbar-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜笔记，按相关度找"
              spellCheck={false}
              aria-label="搜索笔记"
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

      <main className="main">
        {view === 'stream' ? (
          <Stream
            notes={app.notes}
            review={review}
            revealed={app.revealed}
            reviewedToday={app.log[todayKey] ?? 0}
            query={query}
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
          onClose={() => setComposer(null)}
          onSubmit={async (text) => {
            if (composer.mode === 'create') {
              const ok = await addNote(text);
              if (ok) {
                setQuery('');
                setView('stream');
              }
              return ok;
            }
            if (composer.noteId) await editNote(composer.noteId, text);
            return true;
          }}
        />
      )}

      {app.toast && (
        <div className={`toast toast-${app.toast.tone}`} key={app.toast.id} role="status">
          {app.toast.text}
        </div>
      )}
    </div>
  );
}
