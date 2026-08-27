import type { LucideIcon } from 'lucide-react';

export function AppIcon({ icon: Icon, name, size = 18 }: { icon: LucideIcon; name: string; size?: number }) {
  return <Icon aria-hidden="true" data-icon-name={name} size={size} strokeWidth={1.75} />;
}

export function DiaryMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      data-brand-mark="one-diary"
      className="diary-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
    >
      <path d="M6.75 7.5c3.5-1.25 6.58-.75 9.25 1.5v17c-2.67-2.25-5.75-2.75-9.25-1.5v-17Z" />
      <path d="M25.25 7.5C21.75 6.25 18.67 6.75 16 9v17c2.67-2.25 5.75-2.75 9.25-1.5v-17Z" />
      <path d="M10 12.25c1.65-.22 3.08.07 4.25.88M21.9 12.25c-1.65-.22-3.08.07-4.25.88" />
      <circle cx="16" cy="5.75" r="1.4" />
    </svg>
  );
}
