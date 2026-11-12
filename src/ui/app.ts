import { subscribe } from '../store';
import type { Note } from '../types';
import { el, mount } from '../util/dom';
import { openComposer as openSheet } from './composer';
import { icon } from './icon';
import { renderLibrary } from './library';
import { renderNote, resetSession } from './note';
import { toast } from './toast';

type ViewName = 'note' | 'library';

export interface Ctx {
  refresh(): void;
  go(view: ViewName): void;
  openComposer(note?: Note): Promise<boolean>;
}

let view: ViewName = 'note';
let stageEl: HTMLElement;
let tabNote: HTMLButtonElement;
let tabLibrary: HTMLButtonElement;

const ctx: Ctx = {
  refresh: () => render(),
  go: (next) => go(next),
  openComposer: async (note) => {
    const saved = await openSheet(note);
    if (saved) {
      if (!note) view = 'note';
      resetSession();
      render();
      toast(note ? '已更新' : '记下了，它会在合适的时候回来找你');
    }
    return saved;
  },
};

function go(next: ViewName): void {
  if (next === view) return;
  view = next;
  if (next === 'note') resetSession();
  render();
}

function render(): void {
  tabNote.classList.toggle('is-active', view === 'note');
  tabLibrary.classList.toggle('is-active', view === 'library');
  if (view === 'note') renderNote(stageEl, ctx);
  else renderLibrary(stageEl, ctx);
}

export function mountApp(root: HTMLElement): void {
  const brand = el('div', { class: 'brand' }, [
    el('span', { class: 'brand-mark', html: icon.logo }),
    el('div', { class: 'brand-text' }, [
      el('h1', { text: 'NiceNotes' }),
      el('p', { text: '写一句就够' }),
    ]),
  ]);

  tabNote = el('button', { class: 'tab is-active', text: '笔记' });
  tabLibrary = el('button', { class: 'tab', text: '全部' });
  tabNote.addEventListener('click', () => go('note'));
  tabLibrary.addEventListener('click', () => go('library'));

  const newBtn = el('button', {
    class: 'btn btn-primary btn-sm',
    html: `${icon.plus}<span>记一条</span>`,
  });
  newBtn.addEventListener('click', () => void ctx.openComposer());

  const bar = el('header', { class: 'topbar' }, [
    brand,
    el('nav', { class: 'tabs' }, [tabNote, tabLibrary]),
    newBtn,
  ]);

  stageEl = el('main', { class: 'stage' });

  const foot = el('footer', { class: 'foot' }, [el('span', { text: 'NiceNotes' })]);

  mount(root, bar, stageEl, foot);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      void ctx.openComposer();
    }
  });

  subscribe(render);
  render();
}
