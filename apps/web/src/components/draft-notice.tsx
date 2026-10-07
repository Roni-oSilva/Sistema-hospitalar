'use client';

import { fmtTime } from '@/lib/format';
import { Alert, Button } from './ui';

/** Avisa que o formulário foi preenchido com um rascunho local (texto que não chegou a ser salvo). */
export function DraftRestoredNotice({ savedAt, onDiscard }: { savedAt: number; onDiscard: () => void }) {
  return (
    <Alert
      tone="info"
      title="Recuperamos o que tinha sido digitado e não foi salvo"
      actions={
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Descartar e voltar ao que está salvo
        </Button>
      }
    >
      Rascunho de {fmtTime(new Date(savedAt).toISOString())} (a conexão caiu ou a tela foi recarregada). Confira e salve.
    </Alert>
  );
}

/** Dados desta tela não puderam ser atualizados agora, mas o formulário continua aberto. */
export function StaleDataNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert
      tone="warn"
      title="Não foi possível atualizar esta tela agora"
      actions={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      }
    >
      O que você digitou continua aqui. Os dados exibidos podem estar desatualizados até a conexão voltar.
    </Alert>
  );
}
