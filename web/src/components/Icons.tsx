const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type Props = { size?: number; className?: string };

export function PlusIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" {...stroke} />
    </svg>
  );
}

export function SearchIcon({ size = 15, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="5.2" {...stroke} />
      <path d="M12.9 12.9 16 16" {...stroke} />
    </svg>
  );
}

export function SettingsIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M3.4 6.4h13.2M3.4 13.6h13.2" {...stroke} />
      <circle cx="7.6" cy="6.4" r="1.9" {...stroke} />
      <circle cx="12.6" cy="13.6" r="1.9" {...stroke} />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" {...stroke} />
    </svg>
  );
}

export function TrashIcon({ size = 15, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M4.5 6.2h11M8 6.2V4.6h4v1.6M6.2 6.2l.7 9.1h6.2l.7-9.1" {...stroke} />
    </svg>
  );
}

export function CloudIcon({ size = 15, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M6.4 15.2a3.4 3.4 0 0 1-.4-6.8 4 4 0 0 1 7.7-.6 3.2 3.2 0 0 1 .3 6.4Z" {...stroke} />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M11.5 5 6.5 10l5 5" {...stroke} />
    </svg>
  );
}

export function RefreshIcon({ size = 15, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M15.5 8.4A5.8 5.8 0 1 0 16 11" {...stroke} />
      <path d="M15.8 4.8v3.8h-3.8" {...stroke} />
    </svg>
  );
}
