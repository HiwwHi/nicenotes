const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type Props = { size?: number; className?: string };

export function CheckIcon({ size = 12, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M4.5 10.5l3.6 3.6 7.4-7.8" {...stroke} strokeWidth={2.2} />
    </svg>
  );
}

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

export function PencilIcon({ size = 14, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M12.4 4.3 15.7 7.6M4.2 15.8l3.3-.6 7.4-7.4-2.7-2.7-7.4 7.4-.6 3.3Z" {...stroke} />
    </svg>
  );
}

export function LinkIcon({ size = 13, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M8.6 11.4a3.2 3.2 0 0 0 4.6 0l2.2-2.2a3.3 3.3 0 0 0-4.7-4.7L9.5 5.7" {...stroke} />
      <path d="M11.4 8.6a3.2 3.2 0 0 0-4.6 0l-2.2 2.2a3.3 3.3 0 0 0 4.7 4.7l1.2-1.2" {...stroke} />
    </svg>
  );
}

export function HourglassIcon({ size = 14, className }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <path d="M6.2 3.6h7.6M6.2 16.4h7.6M6.6 3.6v2.4c0 1.4 1.5 2.4 3.4 4 1.9-1.6 3.4-2.6 3.4-4V3.6M6.6 16.4v-2.4c0-1.4 1.5-2.4 3.4-4 1.9 1.6 3.4 2.6 3.4 4v2.4" {...stroke} />
    </svg>
  );
}
