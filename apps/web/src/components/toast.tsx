'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cx } from './ui';

type ToastTone = 'ok' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

const ToastCtx = createContext<{ show: (tone: ToastTone, title: string, message?: string) => void } | null>(null);

/** Feedback visual imediato; anunciado por leitores de tela (aria-live). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((tone: ToastTone, title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, title, message }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed top-20 right-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = t.tone === 'ok' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto flex animate-[slide-in_180ms_ease-out] gap-3 rounded-[var(--radius-card)] border bg-surface px-4 py-3 shadow-[var(--shadow-float)]',
                t.tone === 'ok' && 'border-ok/40',
                t.tone === 'error' && 'border-danger/50',
                t.tone === 'info' && 'border-accent/40',
              )}
            >
              <Icon className={cx('mt-0.5 size-5 shrink-0', t.tone === 'ok' ? 'text-ok' : t.tone === 'error' ? 'text-danger' : 'text-accent')} aria-hidden />
              <div className="flex-1">
                <p className="font-semibold text-ink">{t.title}</p>
                {t.message && <p className="text-sm text-ink-2">{t.message}</p>}
              </div>
              <button type="button" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="self-start rounded p-1 text-ink-3 hover:bg-sunken" aria-label="Fechar aviso">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast fora do ToastProvider');
  return ctx;
}
