import { isNew } from '../scheduler';
import {
  exportNotes,
  getNotes,
  importNotes,
  removeNote,
  streak,
  totalReviews,
} from '../store';
import type { Note } from '../types';
import { addDays, dayKey, dueLabel, humanAgo, startOfDay } from '../util/date';
import { el, mount } from '../util/dom';
import { icon } from './icon';
import type { Ctx } from './app';

let query = '';
let pendingDelete: string | null = null;

export function renderLibrary(stage: HTMLElement, ctx: Ctx): void {
  const all = getNotes();

  const search = el('input', {
    class: 'search',
    attrs: {
      type: 'search',
      placeholder: '搜点什么…',
      spellcheck: 'false',
      value: query,
    },
  });
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    pendingDelete = null;
    renderList(list, ctx);
  });

  const list = el('div', { class: 'rows' });
  renderList(list, ctx);

  const head = el('div', { class: 'lib-head' }, [
    el('div', { class: 'search-wrap' }, [
      el('span', { class: 'search-icon', html: icon.search }),
      search,
    ]),
    el('span', { class: 'lib-count', text: `${all.length} 条` }),
  ]);

  const body: HTMLElement[] = [head, list];

  if (all.length > 0) {
    body.push(renderFooter(all));
  }

  mount(stage, el('section', { class: 'lib' }, body));

  if (query) {
    const len = search.value.length;
    search.focus();
    search.setSelectionRange(len, len);
  }
}

function renderList(container: HTMLElement, ctx: Ctx): void {
  const q = query.trim().toLowerCase();
  const now = Date.now();
  const notes = getNotes().filter((n) => {
    if (!q) return true;
    return (
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  if (notes.length === 0) {
    mount(
      container,
      el('p', {
        class: 'lib-empty',
        text: q ? `没找到和「${query.trim()}」有关的笔记` : '还没有笔记',
      }),
    );
    return;
  }

  mount(container, ...notes.map((n) => renderRow(n, now, ctx)));
}

function renderRow(note: Note, now: number, ctx: Ctx): HTMLElement {
  const lines = note.body.split('\n');
  const head = (lines[0] ?? '').trim();
  const rest = lines.slice(1).join(' ').trim();

  const state = isNew(note) ? '新的' : dueLabel(note.memory.due, now);
  const dueSoon = !isNew(note) && note.memory.due <= now;

  const del = el('button', {
    class: 'row-del' + (pendingDelete === note.id ? ' is-armed' : ''),
    text: pendingDelete === note.id ? '确认删除' : '',
    html: pendingDelete === note.id ? undefined : icon.trash,
    attrs: { 'aria-label': '删除' },
  });

  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pendingDelete === note.id) {
      pendingDelete = null;
      void removeNote(note.id);
    } else {
      pendingDelete = note.id;
      ctx.refresh();
    }
  });

  const row = el(
    'div',
    {
      class: 'row',
      attrs: { role: 'button', tabindex: 0 },
      on: {
        click: () => {
          pendingDelete = null;
          void ctx.openComposer(note);
        },
        keydown: (e) => {
          if (e.key === 'Enter') {
            pendingDelete = null;
            void ctx.openComposer(note);
          }
        },
      },
    },
    [
      el('div', { class: 'row-main' }, [
        el('p', { class: 'row-title', text: head || '（空）' }),
        rest ? el('p', { class: 'row-rest', text: rest }) : null,
        el('p', { class: 'row-meta' }, [
          el('span', { class: 'chip' + (dueSoon ? ' is-due' : ''), text: state }),
          el('span', {
            class: 'chip-quiet',
            text: `记于 ${humanAgo(now - note.createdAt)}`,
          }),
          ...note.tags.map((t) => el('span', { class: 'chip-tag', text: `#${t}` })),
        ]),
      ]),
      del,
    ],
  );

  return row;
}

function renderFooter(all: Note[]): HTMLElement {
  const days = streak();
  const reviews = totalReviews();

  const fileInput = el('input', {
    attrs: { type: 'file', accept: '.json,application/json' },
    style: 'display:none',
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { notes?: Note[] };
        if (!Array.isArray(parsed.notes)) throw new Error('格式不对');
        await importNotes(parsed.notes);
      } catch {
        alert('这个文件读不了，需要是 NiceNotes 导出的 JSON。');
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  const doExport = () => {
    const blob = new Blob([exportNotes()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { attrs: { href: url, download: `nicenotes-${dayKey(Date.now())}.json` } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stats = el('div', { class: 'stats-row' }, [
    statBlock(String(days), '连续天数'),
    statBlock(String(all.length), '条笔记'),
    statBlock(String(reviews), '次回顾'),
  ]);

  const actions = el('div', { class: 'lib-actions' }, [
    el('button', { class: 'btn btn-ghost btn-sm', html: `${icon.download}<span>导出</span>`, on: { click: doExport } }),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      html: `${icon.upload}<span>导入</span>`,
      on: { click: () => fileInput.click() },
    }),
    el('span', { class: 'lib-note', text: '数据只存在这台设备上' }),
    fileInput,
  ]);

  return el('div', { class: 'lib-foot' }, [stats, buildHeatmap(), actions]);
}

function statBlock(value: string, label: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('b', { text: value }),
    el('span', { text: label }),
  ]);
}

function buildHeatmap(): HTMLElement {
  const counts = new Map<string, number>();
  for (const n of getNotes()) {
    for (const h of n.history) {
      const k = dayKey(h.at);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const today = startOfDay(Date.now());
  let start = addDays(today, -83);
  while (new Date(start).getDay() !== 1) start = addDays(start, -1);

  const cells: HTMLElement[] = [];
  for (let t = start; t <= today; t = addDays(t, 1)) {
    const c = counts.get(dayKey(t)) ?? 0;
    const level = c === 0 ? 0 : c < 3 ? 1 : c < 6 ? 2 : c < 10 ? 3 : 4;
    cells.push(
      el('i', {
        class: `heat-cell l${level}`,
        attrs: { title: `${dayKey(t)} · 回顾 ${c} 次` },
      }),
    );
  }

  return el('div', { class: 'heat-wrap' }, [
    el('p', { class: 'heat-label', text: '最近 12 周' }),
    el('div', { class: 'heat' }, cells),
  ]);
}
