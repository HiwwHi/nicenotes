import { useCallback, useEffect, useState } from 'react';
import { Composer } from './components/Composer';
import { CloudIcon, PlusIcon, RefreshIcon, SettingsIcon } from './components/Icons';
import { Library } from './components/Library';
import { ReviewCard } from './components/ReviewCard';
import { Settings } from './components/Settings';
import { dayKey, dueLabel, splitBody } from './lib/date';
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
  reviewEarly,
  skip,
  syncNow,
  toast,
  useApp,
} from './store';
import type { Grade } from './types';

type View = 'review' | 'library' | 'settings';

interface ComposerState {
  mode: 'create' | 'edit';
  noteId?: string;
  initial: string;
}

export default function App() {
  const app = useApp();
  const [view, setView] = useState<View>('review');
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [composer, setComposer] = useState<ComposerState | null>(null);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    void init();
  }, []);

  useEffect(() => {
    if (app.ready) document.getElementById('boot')?.remove();
  }, [app.ready]);

  const current = app.currentId ? app.notes.find((note) => note.id === app.currentId) : undefined;
  const currentKind: 'due' | 'new' = current && isNew(current) ? 'new' : 'due';

  const openCreate = useCallback(() => setComposer({ mode: 'create', initial: '' }), []);

  const openEdit = useCallback((noteId: string, body: string) => {
    setComposer({ mode: 'edit', noteId, initial: body });
  }, []);

  const onGrade = useCallback(
    (value: Grade) => {
      if (!app.currentId) return;
      void grade(app.currentId, value);
    },
    [app.currentId],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (composer) return;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        openCreate();
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setView('library');
        requestAnimationFrame(() => document.getElementById('search-input')?.focus());
        return;
      }

      if (view !== 'review' || !current) return;

      if (event.key === ' ') {
        event.preventDefault();
        if (!app.revealed) reveal();
        return;
      }

      if (event.key === '1' || event.key === '2' || event.key === '3') {
        if (!app.revealed && splitBody(current.body).rest) return;
        event.preventDefault();
        void grade(
          current.id,
          (Number(event.key) - 1) as Grade,
        );
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.revealed, composer, current, openCreate, view]);

  const todayKey = dayKey(Date.now());

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

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <span className="brand-name">NiceNotes</span>
        </div>

        <nav className="tabs" aria-label="主导航">
          <button
            type="button"
            className={view === 'review' ? 'is-active' : ''}
            onClick={() => setView('review')}
          >
            复习
          </button>
          <button
            type="button"
            className={view === 'library' ? 'is-active' : ''}
            onClick={() => setView('library')}
          >
            全部
          </button>
        </nav>

        <div className="top-actions">
          {app.account && (
            <button
              type="button"
              className="icon-btn"
              title={app.syncing ? '同步中' : '立即同步'}
              aria-label="立即同步"
              disabled={app.syncing}
              onClick={() => void syncNow()}
            >
              {app.syncing ? <RefreshIcon className="spin" /> : <CloudIcon />}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <PlusIcon />
            <span>记一条</span>
          </button>
          <button
            type="button"
            className={`icon-btn ${view === 'settings' ? 'is-active' : ''}`}
            aria-label="设置"
            onClick={() => setView('settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <main className={`main ${view === 'review' ? 'main-review' : ''}`}>
        {view === 'review' &&
          (current ? (
            <ReviewCard
              note={current}
              kind={currentKind}
              revealed={app.revealed}
              reviewedToday={app.log[todayKey] ?? 0}
              onReveal={reveal}
              onGrade={onGrade}
              onEdit={() => openEdit(current.id, current.body)}
              onSkip={skip}
            />
          ) : (
            <EmptyState onCreate={openCreate} onBrowse={() => setView('library')} />
          ))}

        {view === 'library' && (
          <Library
            notes={app.notes}
            log={app.log}
            onEdit={(note) => openEdit(note.id, note.body)}
            onDelete={(id) => void removeNote(id)}
          />
        )}

        {view === 'settings' && <Settings theme={theme} onTheme={setTheme} />}
      </main>

      <footer className="foot">
        <span>
          NiceNotes · 写一句就够，它会在你快忘记的时候回来找你
          {app.account ? '' : ' · 数据只在这台设备上'}
        </span>
      </footer>

      {composer && (
        <Composer
          mode={composer.mode}
          initial={composer.initial}
          noteId={composer.noteId}
          onClose={() => setComposer(null)}
          onSubmit={async (text) => {
            if (composer.mode === 'create') return addNote(text);
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

function EmptyState({ onCreate, onBrowse }: { onCreate: () => void; onBrowse: () => void }) {
  const app = useApp();
  const now = Date.now();
  const alive = app.notes.filter((note) => !note.deletedAt);
  const fresh = alive.filter(isNew).length;
  const soon = nextSoonest();
  const hasReviewed = alive.some((note) => !isNew(note));

  let title = '今天的都复习完了';
  let desc = soon ? `下一次会在 ${dueLabel(soon, now)} 回来。` : '记一条，明天就有东西可复习。';

  if (alive.length === 0) {
    title = '还没有笔记';
    desc = '想到什么写一句就行，不用起标题。它会在你快忘记的时候自己回来。';
  } else if (fresh > 0) {
    title = '今天的新笔记看完了';
    desc = `还压着 ${fresh} 条没排进来。新笔记一天最多放 3 条，多了就变成负担。`;
  }

  return (
    <section className="empty">
      <h1>{title}</h1>
      <p>{desc}</p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          <PlusIcon />
          <span>记一条</span>
        </button>
        {hasReviewed && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              reviewEarly();
              toast('提前看一条最近的');
            }}
          >
            提前看一条
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onBrowse}>
          浏览全部
        </button>
      </div>
    </section>
  );
}
