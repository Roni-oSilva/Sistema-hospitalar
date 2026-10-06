'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { io } from 'socket.io-client';
import { Volume2, VolumeX, WifiOff } from 'lucide-react';
import { REALTIME_EVENTS, type PanelCallEvent } from '@hospital/shared';
import { SOCKET_URL } from '@/lib/realtime';
import { prefs } from '@/lib/prefs';
import { fmtTime } from '@/lib/format';
import { LogoMark } from '@/components/logo';

interface PanelData {
  hospitalName: string;
  calls: PanelCallEvent[];
}

/**
 * PAINEL PÚBLICO (TV da sala de espera). Mostra SOMENTE senha, número do atendimento e consultório.
 * Nunca nome, idade, CPF, deficiência, sintomas, classificação ou qualquer dado médico.
 */
function Panel() {
  const params = useSearchParams();
  const key = params.get('key') ?? '';
  const [data, setData] = useState<PanelData | null>(null);
  const [online, setOnline] = useState(true);
  const [flash, setFlash] = useState(0);
  const [sound, setSound] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [denied, setDenied] = useState(false);
  const soundRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setSound(prefs.panelSound());
  }, []);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/panel${key ? `?key=${encodeURIComponent(key)}` : ''}`, { cache: 'no-store' });
      if (res.status === 403) {
        setDenied(true);
        return;
      }
      if (res.ok) setData((await res.json()) as PanelData);
    } catch {
      /* rede instável: mantém a última tela e tenta de novo */
    }
  }, [key]);

  const announce = useCallback((c: PanelCallEvent) => {
    if (!soundRef.current) return;
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      [0, 0.28].forEach((t, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i ? 660 : 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.26);
      });
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(`Senha ${c.ticket.split('').join(' ')}. ${c.room}.`);
        u.lang = 'pt-BR';
        u.rate = 0.9;
        window.setTimeout(() => window.speechSynthesis.speak(u), 650);
      }
    } catch {
      /* sem áudio disponível */
    }
  }, []);

  useEffect(() => {
    void load();
    const socket = io(`${SOCKET_URL ?? ''}/painel`, { path: '/socket.io', auth: { key }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setOnline(true);
      void load();
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', () => setOnline(false));
    socket.on(REALTIME_EVENTS.PANEL_CALL, (c: PanelCallEvent) => {
      setData((prev) => (prev ? { ...prev, calls: [c, ...prev.calls].slice(0, 8) } : prev));
      setFlash((n) => n + 1);
      announce(c);
    });
    const poll = setInterval(() => void load(), 30_000); // rede de segurança
    const tick = setInterval(() => setClock(new Date()), 15_000);
    return () => {
      socket.close();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [key, load, announce]);

  if (denied) {
    return (
      <main className="brand-gradient grid min-h-screen place-items-center p-8 text-center text-white">
        <p className="text-2xl">Painel não autorizado. Verifique o endereço configurado nesta TV.</p>
      </main>
    );
  }

  const [current, ...recent] = data?.calls ?? [];

  return (
    <main className="brand-gradient flex min-h-screen flex-col text-white">
      <header className="flex items-center justify-between gap-4 px-10 py-6">
        <p className="flex items-center gap-3 font-display text-2xl font-extrabold"><LogoMark className="size-11" />{data?.hospitalName ?? 'Hospital Municipal de Ulianópolis'}</p>
        <div className="flex items-center gap-4">
          {!online && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg">
              <WifiOff className="size-5" aria-hidden /> Reconectando…
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !sound;
              setSound(next);
              prefs.setPanelSound(next);
              if (next) audioRef.current = audioRef.current ?? new AudioContext();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg hover:bg-white/20"
            aria-pressed={sound}
          >
            {sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
            {sound ? 'Som e voz ativos' : 'Ativar som e voz'}
          </button>
          <time className="tabular font-display text-4xl font-extrabold">{fmtTime(clock.toISOString())}</time>
        </div>
      </header>

      <section aria-live="assertive" aria-atomic="true" className="flex flex-1 flex-col items-center justify-center px-10">
        {current ? (
          <div key={flash} className="w-full max-w-6xl animate-[call-flash_1.2s_ease-out_3] rounded-[2rem] px-10 py-12 text-center">
            <p className="inline-flex rounded-full bg-lime px-6 py-1.5 font-display text-2xl font-extrabold tracking-[0.25em] text-ink uppercase">Senha</p>
            <p className="tabular font-display text-[clamp(8rem,22vw,18rem)] leading-none font-extrabold drop-shadow-[0_12px_30px_rgb(0_0_0/0.25)]">{current.ticket}</p>
            <p className="tabular mt-4 font-mono text-[clamp(2rem,4vw,3.5rem)] font-semibold text-white/85">{current.code}</p>
            <p className="mt-8 font-display text-[clamp(2rem,4vw,3.5rem)] font-extrabold uppercase">
              Dirija-se ao <span className="rounded-full bg-lime px-6 py-1 text-ink">{current.room}</span>
            </p>
            {current.recall && <p className="mt-4 text-2xl text-white/70">Chamando novamente</p>}
          </div>
        ) : (
          <p className="text-4xl text-white/60">Aguarde ser chamado(a) pelo painel.</p>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-label="Chamadas anteriores" className="border-t border-white/10 px-10 py-6">
          <p className="mb-3 text-xl font-semibold text-white/60">Últimas chamadas</p>
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {recent.slice(0, 5).map((c) => (
              <li key={`${c.code}-${c.calledAt}`} className="rounded-3xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
                <p className="tabular font-display text-5xl font-extrabold">{c.ticket}</p>
                <p className="text-xl text-white/80">{c.room}</p>
                <p className="tabular font-mono text-base text-white/55">
                  {c.code} · {fmtTime(c.calledAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function PanelPage() {
  return (
    <Suspense>
      <Panel />
    </Suspense>
  );
}
