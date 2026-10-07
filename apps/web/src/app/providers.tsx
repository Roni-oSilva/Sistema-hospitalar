'use client';

import { useState, type ReactNode } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/toast';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // O servidor fica na rede do hospital: não depender do "online/offline" do navegador (que pode achar que
          // uma rede sem internet está offline e pausar tudo em silêncio). Cada chamada tenta e, se falhar, avisa.
          queries: {
            networkMode: 'always',
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
          // ações (chamar, iniciar, salvar) nunca ficam "na fila" para disparar sozinhas quando a rede voltar
          mutations: { networkMode: 'always' },
        },
        mutationCache: new MutationCache(),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
