/**
 * Hora do SERVIDOR no navegador. Tempos de espera, metas e o relógio da TV não podem depender do relógio de
 * cada computador: sem internet, Windows/Android deixam de acertar a hora sozinhos e um PC adiantado mostraria
 * esperas erradas. Cada resposta da API traz o cabeçalho `Date` (resolução de 1 s), usado para medir a diferença.
 */
let offsetMs = 0;
let bestRoundTrip = Number.POSITIVE_INFINITY;
let sampledAt = 0;

/** Registra uma amostra a partir do cabeçalho `Date` de uma resposta. */
export function noteServerDate(dateHeader: string | null, sentAt: number, receivedAt: number): void {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return;
  const roundTrip = receivedAt - sentAt;
  // a amostra mais rápida é a mais precisa; depois de 10 min aceita uma nova (o relógio local pode ter sido ajustado)
  if (roundTrip > bestRoundTrip && receivedAt - sampledAt < 10 * 60_000) return;
  bestRoundTrip = roundTrip;
  sampledAt = receivedAt;
  // o cabeçalho trunca os milissegundos: +500 ms centraliza o erro
  offsetMs = server + 500 - (sentAt + receivedAt) / 2;
}

/** Agora, pelo relógio do servidor (ms desde 1970). */
export const serverNow = (): number => Date.now() + offsetMs;
