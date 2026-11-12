const stroke = (d: string, size = 18): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icon = {
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
  close: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: stroke('<path d="M15 5l-7 7 7 7"/>'),
  list: stroke('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  trash: stroke('<path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 12.5h9L17.5 7"/>'),
  download: stroke('<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19h14"/>'),
  upload: stroke('<path d="M12 16V5M7.5 9l4.5-4.5L16.5 9M5 19h14"/>'),
  check: stroke('<path d="M5 13l4.5 4.5L19 7"/>'),
  // 品牌标记：回声涟漪
  logo: `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--brand-bg, #2F6B50)"/>
    <circle cx="11" cy="16" r="2.4" fill="#F7F4EC"/>
    <path d="M16.5 10.8a6.8 6.8 0 0 1 0 10.4" stroke="#F7F4EC" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M21 8a10.6 10.6 0 0 1 0 16" stroke="#F7F4EC" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.5"/>
  </svg>`,
};
