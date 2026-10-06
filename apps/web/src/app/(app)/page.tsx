'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

/** "/" leva cada perfil direto para a sua tela de trabalho. */
export default function Home() {
  const { me } = useSession();
  const router = useRouter();
  useEffect(() => router.replace(homeFor(me)), [me, router]);
  return <Spinner label="Abrindo sua tela de trabalho…" />;
}
