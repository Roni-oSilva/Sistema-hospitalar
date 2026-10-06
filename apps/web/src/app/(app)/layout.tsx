'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { RealtimeProvider } from '@/lib/realtime';
import { AppShell } from '@/components/app-shell';

/** Área autenticada: sessão obrigatória + tempo real + navegação por perfil. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </SessionProvider>
  );
}
