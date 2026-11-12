import { isNew, previewDue } from '../scheduler';
import { addNote, buildQueue, getNotes, review, streak } from '../store';
import type { Grade, Note } from '../types';
import { humanAgo } from '../util/date';
import { el, mount } from '../util/dom';
import type { Ctx } from './app';

let queue: Note[] | null = null;
let index = 0;
let revealed = false;
let busy = false;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function resetSession(): void {
  queue = null;
  index = 0;
  revealed = false;
  busy = false;
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
}

function setKeys(fn: ((e: KeyboardEvent) => void) | null): void {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = fn;
  if (fn) document.addEventListener('keydown', fn);
}

const SAMPLES: Array<{ body: string; tags: string[] }> = [
  {
    body: '间隔重复的核心\n不是反复看，而是在快要忘记的那一刻，费力把它想起来。回忆这个动作本身，才是记忆变牢的原因。',
    tags: ['方法'],
  },
  {
    body: '费曼技巧\n讲不清楚，就是没真懂。合上书，用大白话讲给一个外行听，卡住的地方就是缺口。',
    tags: ['方法'],
  },
  {
    body: '为什么笔记会死\n因为写的时候是给「未来的自己」看的，但未来的自己根本不知道它存在。',
    tags: ['观察'],
  },
  {
    body: '睡眠与记忆\n白天学的东西，是在睡着之后才被搬进长期记忆的。熬夜复习，等于把搬运工辞退了。',
    tags: ['科学'],
  },
];

export function renderNote(stage: HTMLElement, ctx: Ctx): void {
  const now = Date.now();

  if (!queue) {
    queue = buildQueue(now).queue;
    index = 0;
    revealed = false;
  }

  if (getNotes().length === 0) {
    renderEmpty(stage, ctx);
    return;
  }

  if (index >= queue.length) {
    renderDone(stage, ctx);
    return;
  }

  const note = queue[index]!;
  const total = queue.length;

  const lines = note.body.split('\n');
  const head = (lines[0] ?? '').trim();
  const rest = lines.slice(1).join('\n').trim();

  const progress = el('div', { class: 'note-progress' }, [
    el('i', { style: `width:${Math.max(4, (index / total) * 100)}%` }),
  ]);

  const when = isNew(note)
    ? '第一次见'
    : note.memory.lastReview
      ? `上次见它是 ${humanAgo(now - note.memory.lastReview)}`
      : '还没回顾过';

  const meta = el('div', { class: 'note-meta' }, [
    el('span', { text: `第 ${index + 1} / ${total} 条` }),
    el('span', { class: 'sep', text: '·' }),
    el('span', { text: when }),
    el('span', { class: 'sep', text: '·' }),
    el('span', { text: note.tags.length ? note.tags.map((t) => `#${t}`).join(' ') : '无标签' }),
  ]);

  const card = el('article', { class: 'card', attrs: { tabindex: 0 } });
  card.append(el('h2', { class: 'card-title', text: head || '（空）' }));
  if (rest) {
    card.append(el('div', { class: 'card-rest', text: rest }));
  }

  const reveal = () => {
    revealed = true;
    card.classList.remove('is-veiled');
    card.querySelector('.reveal-hint')?.remove();
  };

  if (rest && !revealed) {
    card.classList.add('is-veiled');
    card.append(el('button', { class: 'reveal-hint', text: '点一下，看完整内容' }));
  }
  card.addEventListener('click', reveal);

  const grade = (g: Grade) => {
    if (busy) return;
    busy = true;
    index += 1;
    revealed = false;
    void review(note.id, g).finally(() => {
      busy = false;
    });
  };

  const labels: Array<{ g: Grade; text: string }> = [
    { g: 0, text: '忘了' },
    { g: 1, text: '有点模糊' },
    { g: 2, text: '记得' },
  ];

  const grades = el(
    'div',
    { class: 'grades' },
    labels.map(({ g, text }) =>
      el('button', { class: `grade g${g}`, on: { click: () => grade(g) } }, [
        el('span', { class: 'grade-label', text }),
        el('small', { text: previewDue(note.memory, g, now) }),
      ]),
    ),
  );

  const skip = el('button', {
    class: 'skip',
    text: '先跳过这条',
    on: {
      click: () => {
        index += 1;
        revealed = false;
        ctx.refresh();
      },
    },
  });

  mount(
    stage,
    el('section', { class: 'note-view' }, [progress, meta, card, grades, skip]),
  );

  setKeys((e) => {
    if (document.querySelector('.modal')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '1') grade(0);
    else if (e.key === '2') grade(1);
    else if (e.key === '3') grade(2);
    else if (e.key === ' ') {
      e.preventDefault();
      reveal();
    }
  });
}

function renderEmpty(stage: HTMLElement, ctx: Ctx): void {
  setKeys(null);

  const seed = async () => {
    resetSession();
    for (const s of SAMPLES) await addNote(s.body, s.tags);
    resetSession();
    ctx.refresh();
  };

  mount(
    stage,
    el('section', { class: 'empty' }, [
      el('p', { class: 'eyebrow', text: '还什么都没写' }),
      el('h2', { class: 'empty-title', text: '你说过的话，会回来看你' }),
      el('p', {
        class: 'empty-text',
        text: 'NiceNotes 只做一件事：你随手记下的一句话，在你快要忘记的那一刻，自己出现。不用整理，不用建目录。',
      }),
      el('div', { class: 'empty-actions' }, [
        el('button', {
          class: 'btn btn-primary',
          text: '写下第一条',
          on: { click: () => void ctx.openComposer() },
        }),
        el('button', {
          class: 'btn btn-ghost',
          text: '先放几条示例进来',
          on: { click: () => void seed() },
        }),
      ]),
    ]),
  );
}

function renderDone(stage: HTMLElement, ctx: Ctx): void {
  setKeys(null);

  const built = buildQueue(Date.now());
  const days = streak();
  const total = getNotes().length;

  const children = [
    el('p', { class: 'eyebrow', text: '今天的都见完了' }),
    el('h2', { class: 'empty-title', text: '都见过了' }),
    el('p', {
      class: 'empty-text',
      text:
        days > 0
          ? `连续 ${days} 天。${built.remaining > 0 ? `还有 ${built.remaining} 条排在后面。` : '剩下的会按排期自己回来。'}`
          : `你现在有 ${total} 条笔记，它们会在合适的时候回来。`,
    }),
    el('div', { class: 'empty-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        text: '再记一条',
        on: { click: () => void ctx.openComposer() },
      }),
      el('button', {
        class: 'btn btn-ghost',
        text: '看看全部',
        on: { click: () => ctx.go('library') },
      }),
    ]),
  ];

  if (built.remaining > 0) {
    children.splice(3, 0, el('p', {
      class: 'empty-sub',
      text: '已经把今天最该回想的那批过完了，剩下的明天再给你。',
    }));
  }

  mount(stage, el('section', { class: 'empty' }, children));
}
