import { cx } from './ui';

/** Marca: coração com cruz em verde-limão sobre marinho (linguagem da referência; não usa o emblema protegido da Cruz Vermelha). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx('shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="18" fill="#ffffff" />
      <path d="M32 49s-15-8.6-15-20.2C17 22.6 21.4 18 26.7 18c2.6 0 4.2 1.2 5.3 2.7 1.1-1.5 2.7-2.7 5.3-2.7C42.6 18 47 22.6 47 28.8 47 40.4 32 49 32 49Z" fill="#0f3d7d" />
      <path d="M29 27h6v4.5h4.5v6H35V42h-6v-4.5h-4.5v-6H29Z" fill="#5ef07c" />
    </svg>
  );
}
