import { Inject, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import { parse as parseCookie } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { PERMISSIONS, SOCKET_ROOMS } from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AppLogger } from '../common/logger/app-logger';
import { SessionService } from '../auth/session.service';
import { RealtimeService } from './realtime.service';

/**
 * WebSocket autenticado (Socket.IO). O navegador envia o cookie de sessão no handshake (mesma origem via proxy).
 * Cada socket entra apenas nas salas a que sua permissão dá direito. A sessão é revalidada a cada minuto:
 * sessão expirada/revogada derruba a conexão (o WebSocket NÃO conta como atividade para o timeout de inatividade).
 */
@WebSocketGateway({ path: '/socket.io', transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private timer: NodeJS.Timeout | null = null;
  private readonly sessionBySocket = new Map<string, string>();

  constructor(
    private readonly realtime: RealtimeService,
    private readonly sessions: SessionService,
    private readonly logger: AppLogger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    // CORS/Origin: somente as origens do frontend
    server.engine.opts.cors = { origin: this.config.webOrigins, credentials: true };
    server.engine.opts.allowRequest = (req: IncomingMessage, cb: (err: string | null | undefined, ok: boolean) => void) => {
      const origin = req.headers.origin;
      if (!origin || this.config.webOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      return cb('origin not allowed', false);
    };
    this.timer = setInterval(() => void this.revalidateAll(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const cookies = parseCookie(client.handshake.headers.cookie ?? '');
      const result = await this.sessions.validate(cookies[this.config.cookieName], { touch: false });
      if (!result.ok || result.value.actorBase.mustChangePassword) {
        client.disconnect(true);
        return;
      }
      const { permissions, userId } = result.value.actorBase;
      const rooms: string[] = [`user:${userId}`];
      if (permissions.has(PERMISSIONS.ATTENDANCES_CREATE) || permissions.has(PERMISSIONS.PATIENTS_SEARCH)) rooms.push(SOCKET_ROOMS.RECEPCAO);
      if (permissions.has(PERMISSIONS.TRIAGE_QUEUE)) rooms.push(SOCKET_ROOMS.TRIAGEM);
      if (permissions.has(PERMISSIONS.MEDICAL_QUEUE)) rooms.push(SOCKET_ROOMS.MEDICO);
      if (permissions.has(PERMISSIONS.INDICATORS_READ) || permissions.has(PERMISSIONS.USERS_READ)) rooms.push(SOCKET_ROOMS.ADMIN);
      await client.join(rooms);
      this.sessionBySocket.set(client.id, result.value.sessionId);
      client.on('disconnect', () => this.sessionBySocket.delete(client.id));
    } catch (e) {
      this.logger.warn('Falha ao autenticar socket', { detail: (e as Error).message });
      client.disconnect(true);
    }
  }

  private async revalidateAll(): Promise<void> {
    if (!this.server) return;
    for (const [socketId, sessionId] of this.sessionBySocket) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) {
        this.sessionBySocket.delete(socketId);
        continue;
      }
      try {
        const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
        const result = await this.sessions.validate(cookies[this.config.cookieName], { touch: false });
        if (!result.ok || result.value.sessionId !== sessionId) socket.disconnect(true);
      } catch {
        /* erro transitório de banco: tenta de novo no próximo ciclo */
      }
    }
  }
}
