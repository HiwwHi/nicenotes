import { addNote, editNote } from '../store';
import type { Note } from '../types';
import { el } from '../util/dom';
import { icon } from './icon';

/**
 * 记录/编辑一张笔记。返回 true 表示存下来了。
 * 刻意做得很轻：一个输入框、一个可选的标签框，Ctrl+Enter 就走。
 */
export function openComposer(initial?: Note): Promise<boolean> {
  const editing = Boolean(initial);

  return new Promise((resolve) => {
    const area = el('textarea', {
      class: 'composer-area',
      attrs: {
        rows: 6,
        placeholder: editing
          ? ''
          : '写一句话。它会在你快忘记的时候，自己回来找你。\n\n第二行开始的内容会被先藏起来，留给你回想。',
        spellcheck: 'false',
      },
    });
    area.value = initial?.body ?? '';

    const tags = el('input', {
      class: 'composer-tags',
      attrs: { type: 'text', placeholder: '标签，空格分隔（可以不填）', spellcheck: 'false' },
    });
    tags.value = initial?.tags.join(' ') ?? '';

    const saveBtn = el('button', { class: 'btn btn-primary', text: editing ? '保存' : '记下' });

    let closed = false;

    const close = (saved: boolean) => {
      if (closed) return;
      closed = true;
      document.body.classList.remove('no-scroll');
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      resolve(saved);
    };

    const submit = async () => {
      const body = area.value.trim();
      if (!body) {
        area.focus();
        return;
      }
      const list = tags.value
        .split(/[\s,，、]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      saveBtn.disabled = true;
      try {
        if (initial) await editNote(initial.id, body, list);
        else await addNote(body, list);
        close(true);
      } catch (err) {
        saveBtn.disabled = false;
        console.error(err);
      }
    };

    saveBtn.addEventListener('click', () => void submit());

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onEsc);

    const sheet = el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('span', { class: 'eyebrow', text: editing ? '修改这一条' : '记一条' }),
        el('button', { class: 'icon-btn', html: icon.close, attrs: { 'aria-label': '关闭' } }),
      ]),
      area,
      el('div', { class: 'sheet-foot' }, [
        tags,
        el('span', { class: 'kbd-hint', text: 'Ctrl / ⌘ + Enter' }),
        saveBtn,
      ]),
    ]);

    const closeBtn = sheet.querySelector('.icon-btn');
    closeBtn?.addEventListener('click', () => close(false));

    // 快捷键绑在整个面板上，正文框和标签框里都能用
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    });

    const overlay = el('div', { class: 'modal' }, [sheet]);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(false);
    });

    document.body.append(overlay);
    document.body.classList.add('no-scroll');
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
}
