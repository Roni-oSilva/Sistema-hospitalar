import { Inject } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { timingSafeEqual } from 'node:crypto';
import type { Namespace, Socket } from 'socket.io';
import { APP_CONFIG, AppConfig } from '../config/env';
import { RealtimeService } from './realtime.service';

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Namespace PÚBLICO /painel para a TV de chamada. Sem login — por isso só transmite
 * senha + número do atendimento + consultório. Se PUBLIC_PANEL_KEY estiver configurada, o aparelho precisa da chave.
 */
@WebSocketGateway({ namespace: '/painel', path: '/socket.io' })
export class PanelGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(namespace: Namespace): void {
    this.realtime.attachPanel(namespace as never);
  }

  handleConnection(client: Socket): void {
    const key = this.config.publicPanelKey;
    if (!key) return;
    const provided = String((client.handshake.auth as Record<string, unknown> | undefined)?.key ?? client.handshake.query.key ?? '');
    if (!safeEqual(provided, key)) client.disconnect(true);
  }
}
