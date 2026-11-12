export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'nicenotes.theme';

export function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw;
  } catch {
    /* 无痕模式 */
  }
  return 'auto';
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme): void {
  const resolved = theme === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);

  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* 忽略 */
  }

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#14130F' : '#F7F4EE');
}
