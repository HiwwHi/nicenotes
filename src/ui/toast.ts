import { el } from '../util/dom';

let current: HTMLElement | null = null;
let timer: number | undefined;

/** 一句话的轻反馈，2.2 秒后自己淡出 */
export function toast(message: string): void {
  if (current) current.remove();
  if (timer) window.clearTimeout(timer);

  const node = el('div', { class: 'toast', text: message });
  document.body.append(node);
  current = node;

  timer = window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => {
      node.remove();
      if (current === node) current = null;
    }, 260);
  }, 2200);
}
