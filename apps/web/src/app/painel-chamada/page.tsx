'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { io } from 'socket.io-client';
import { MicOff, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { REALTIME_EVENTS, type PanelCallEvent } from '@hospital/shared';
import { SOCKET_URL } from '@/lib/realtime';
import { prefs } from '@/lib/prefs';
import { fmtTime } from '@/lib/format';
import { noteServerDate, serverNow } from '@/lib/clock';
import { LogoMark } from '@/components/logo';

interface PanelData {
  hospitalName: string;
  calls: PanelCallEvent[];
}

const isPortuguese = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-').startsWith('pt');

/**
 * Vozes em português, da melhor para a pior. As vozes instaladas no aparelho (localService) vêm primeiro:
 * as "online" do Chrome (ex.: "Google português do Brasil") param de falar quando a internet cai.
 */
function rankPortugueseVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const score = (v: SpeechSynthesisVoice) => (v.localService ? 0 : 10) + (v.lang.toLowerCase().replace('_', '-') === 'pt-br' ? 0 : 1);
  return voices.filter(isPortuguese).sort((a, b) => score(a) - score(b));
}

const DEFAULT_HOSPITAL = 'Hospital Municipal de Ulianópolis';
/** Chamadas que chegam pela atualização periódica/reconexão só são anunciadas se forem recentes. */
const MISSED_CALL_MAX_AGE_MS = 3 * 60_000;
/** Intervalo entre dois anúncios seguidos (bipe + voz), para não sobrepor. */
const ANNOUNCE_GAP_MS = 6_500;
const callKey = (c: PanelCallEvent) => `${c.code}|${c.calledAt}`;

type VoiceStatus = 'desconhecida' | 'ok' | 'indisponivel';

/**
 * PAINEL PÚBLICO (TV da sala de espera). Mostra SOMENTE senha, número do atendimento e consultório.
 * Nunca nome, idade, CPF, deficiência, sintomas, classificação ou qualquer dado médico.
 *
 * Pensado para ficar ligado o dia todo numa rede que pode oscilar:
 *  - chamadas feitas enquanto a TV estava desconectada são anunciadas quando ela volta (se recentes);
 *  - depois de reiniciar/recarregar, o navegador bloqueia som e voz até alguém tocar na tela: o painel avisa;
 *  - a voz instalada no aparelho tem prioridade (as vozes "online" param sem internet).
 */
function Panel() {
  const params = useSearchParams();
  const key = params.get('key') ?? '';
  const [data, setData] = useState<PanelData | null>(null);
  const [online, setOnline] = useState(true);
  const [flash, setFlash] = useState(0);
  const [sound, setSound] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('desconhecida');
  const [clock, setClock] = useState(() => new Date(serverNow()));
  const [denied, setDenied] = useState(false);
  const soundRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const announcedRef = useRef(new Set<string>());
  const firstLoadRef = useRef(true);
  const nextSlotRef = useRef(0);
  const speakingSinceRef = useRef(0);

  // a lista de vozes chega de forma assíncrona em alguns navegadores
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refresh = () => (voicesRef.current = rankPortugueseVoices(window.speechSynthesis.getVoices()));
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);

  /** Cria/retoma o áudio. Sem um toque na tela (ou o Chrome em modo quiosque com autoplay liberado) fica bloqueado. */
  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      return ctx;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const wanted = prefs.panelSound();
    setSound(wanted);
    soundRef.current = wanted;
    if (!wanted) return;
    // ao abrir com o som ligado (ex.: TV reiniciou), confere se o navegador liberou o áudio
    const ctx = ensureAudio();
    const t = window.setTimeout(() => setAudioBlocked(!ctx || ctx.state !== 'running'), 400);
    return () => window.clearTimeout(t);
  }, [ensureAudio]);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const speak = useCallback((text: string, voices: SpeechSynthesisVoice[]) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voices[0]?.lang ?? 'pt-BR';
    if (voices[0]) u.voice = voices[0];
    u.rate = 0.9;
    u.onstart = () => (speakingSinceRef.current = Date.now());
    u.onend = () => {
      speakingSinceRef.current = 0;
      setVoiceStatus('ok');
    };
    u.onerror = (e) => {
      speakingSinceRef.current = 0;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed') {
        setAudioBlocked(true); // navegador exige um toque na tela
        return;
      }
      // voz online sem internet, voz removida etc.: tenta a próxima instalada antes de desistir
      if (voices.length > 1) speak(text, voices.slice(1));
      else setVoiceStatus('indisponivel');
    };
    window.speechSynthesis.speak(u);
  }, []);

  const announceNow = useCallback(
    (c: PanelCallEvent) => {
      const ctx = ensureAudio();
      if (ctx) {
        if (ctx.state !== 'running') setAudioBlocked(true);
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
      }
      if ('speechSynthesis' in window) {
        // fila de fala presa (acontece em TV ligada o dia todo): destrava antes de falar
        if (speakingSinceRef.current && Date.now() - speakingSinceRef.current > 15_000) {
          window.speechSynthesis.cancel();
          speakingSinceRef.current = 0;
        }
        window.setTimeout(() => speak(`Senha ${c.ticket.split('').join(' ')}. ${c.room}.`, voicesRef.current), 650);
      }
    },
    [ensureAudio, speak],
  );

  /** Anuncia uma chamada uma única vez; várias seguidas entram em fila, sem sobrepor. */
  const announce = useCallback(
    (c: PanelCallEvent) => {
      const k = callKey(c);
      if (announcedRef.current.has(k)) return;
      announcedRef.current.add(k);
      if (announcedRef.current.size > 200) announcedRef.current = new Set([...announcedRef.current].slice(-100));
      setFlash((n) => n + 1);
      if (!soundRef.current) return;
      const now = Date.now();
      const at = Math.max(now, nextSlotRef.current);
      nextSlotRef.current = at + ANNOUNCE_GAP_MS;
      window.setTimeout(() => announceNow(c), at - now);
    },
    [announceNow],
  );

  const load = useCallback(async () => {
    try {
      const sentAt = Date.now();
      const res = await fetch(`/api/public/panel${key ? `?key=${encodeURIComponent(key)}` : ''}`, { cache: 'no-store' });
      noteServerDate(res.headers.get('date'), sentAt, Date.now());
      setClock(new Date(serverNow()));
      if (res.status === 403) {
        setDenied(true);
        return;
      }
      if (!res.ok) return;
      const next = (await res.json()) as PanelData;
      setData(next);
      if (firstLoadRef.current) {
        // ao abrir a TV, o que já estava na tela não é anunciado de novo
        firstLoadRef.current = false;
        next.calls.forEach((c) => announcedRef.current.add(callKey(c)));
        return;
      }
      // chamadas feitas enquanto a TV estava sem conexão: anuncia as recentes, da mais antiga para a mais nova
      const now = serverNow();
      [...next.calls].reverse().forEach((c) => {
        if (now - new Date(c.calledAt).getTime() <= MISSED_CALL_MAX_AGE_MS) announce(c);
        else announcedRef.current.add(callKey(c));
      });
    } catch {
      /* rede instável: mantém a última tela e tenta de novo */
    }
  }, [key, announce]);

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
      setData((prev) => ({
        hospitalName: prev?.hospitalName ?? DEFAULT_HOSPITAL,
        calls: [c, ...(prev?.calls ?? []).filter((x) => callKey(x) !== callKey(c))].slice(0, 8),
      }));
      announce(c);
    });
    const poll = setInterval(() => void load(), 30_000); // rede de segurança
    const tick = setInterval(() => setClock(new Date(serverNow())), 15_000);
    return () => {
      socket.close();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [key, load, announce]);

  /** Toque/clique/tecla em qualquer lugar libera o som bloqueado pelo navegador e testa a voz. */
  const unlock = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    void ctx.resume().then(() => {
      setAudioBlocked(ctx.state !== 'running');
    });
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      speak('Som ativado.', voicesRef.current);
    }
  }, [ensureAudio, speak]);

  useEffect(() => {
    if (!audioBlocked || !sound) return;
    const onGesture = () => unlock();
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [audioBlocked, sound, unlock]);

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
        <p className="flex items-center gap-3 font-display text-2xl font-extrabold"><LogoMark className="size-11" />{data?.hospitalName || DEFAULT_HOSPITAL}</p>
        <div className="flex items-center gap-4">
          {!online && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg">
              <WifiOff className="size-5" aria-hidden /> Reconectando…
            </span>
          )}
          {sound && voiceStatus === 'indisponivel' && !audioBlocked && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg">
              <MicOff className="size-5" aria-hidden /> Voz indisponível — só aviso sonoro
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // o toque no botão já libera o som; não dispara o "toque em qualquer lugar"
              if (!sound) {
                setSound(true);
                soundRef.current = true;
                prefs.setPanelSound(true);
                unlock();
              } else if (audioBlocked) {
                unlock();
              } else {
                setSound(false);
                soundRef.current = false;
                prefs.setPanelSound(false);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg hover:bg-white/20"
            aria-pressed={sound && !audioBlocked}
          >
            {sound && !audioBlocked ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
            {!sound ? 'Ativar som e voz' : audioBlocked ? 'Liberar som' : 'Som e voz ativos'}
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

      {sound && audioBlocked && (
        // depois de reiniciar, o navegador só libera som e voz com um toque: aviso grande para quem passar pela TV
        <button
          type="button"
          onClick={unlock}
          className="mx-10 mb-6 flex items-center justify-center gap-4 rounded-3xl bg-lime px-8 py-5 font-display text-3xl font-extrabold text-ink shadow-xl"
        >
          <Volume2 className="size-9" aria-hidden /> Toque aqui para ligar o som e a voz das chamadas
        </button>
      )}

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
