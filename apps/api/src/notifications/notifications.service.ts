import { Injectable } from '@nestjs/common';
import type { Tx } from '../common/prisma/prisma.service';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Actor } from '../auth/auth.types';

export interface NewNotification {
  type: string;
  title: string;
  message: string;
  /** Código do perfil destinatário (ex.: MEDICO). null = todos. */
  targetRole: string | null;
  attendanceCode?: string;
}

/**
 * Avisos internos. REGRA DE PRIVACIDADE: título/mensagem NUNCA contêm nome de paciente nem dado clínico —
 * apenas o número do atendimento e a ação esperada ("Novo atendimento aguardando triagem").
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(tx: Tx, n: NewNotification) {
    return tx.notification.create({ data: { type: n.type, title: n.title, message: n.message, targetRole: n.targetRole, attendanceCode: n.attendanceCode ?? null } });
  }

  async list(actor: Actor) {
    const since = new Date(Date.now() - 3 * 86_400_000);
    const [rows, user] = await Promise.all([
      this.prisma.notification.findMany({
        where: { createdAt: { gte: since }, OR: [{ targetRole: null }, { targetRole: { in: actor.roles } }] },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { notificationsReadAt: true } }),
    ]);
    const readAt = user.notificationsReadAt;
    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      attendanceCode: r.attendanceCode,
      createdAt: r.createdAt.toISOString(),
      unread: !readAt || r.createdAt > readAt,
    }));
    return { items, unread: items.filter((i) => i.unread).length };
  }

  async markAllRead(actor: Actor): Promise<void> {
    await this.prisma.user.update({ where: { id: actor.userId }, data: { notificationsReadAt: new Date() } });
  }
}
