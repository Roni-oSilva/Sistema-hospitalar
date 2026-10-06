import { Controller, Get, Inject, Query } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { formatTicket } from '../common/sequence.service';
import { forbidden } from '../common/errors/app-error';
import { safeEqual } from '../realtime/panel.gateway';

/**
 * Painel público de chamada (TV). PRIVACIDADE: devolve SOMENTE senha, número do atendimento e consultório.
 * Nunca nome, idade, CPF, deficiência, sintomas, diagnóstico ou qualquer dado médico.
 */
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('panel')
  async panel(@Query('key') key?: string) {
    if (this.config.publicPanelKey && !safeEqual(String(key ?? ''), this.config.publicPanelKey)) {
      throw forbidden('Painel não autorizado.');
    }
    const limit = await this.settings.get('panel.recent_calls');
    const since = new Date(Date.now() - 4 * 3_600_000); // só chamadas das últimas 4 horas
    const calls = await this.prisma.queueCall.findMany({
      where: { calledAt: { gte: since } },
      orderBy: { calledAt: 'desc' },
      take: limit,
      select: { calledAt: true, isRecall: true, room: { select: { name: true } }, attendance: { select: { code: true, ticketNumber: true } } },
    });
    return {
      hospitalName: await this.settings.get('hospital.name'),
      calls: calls.map((c) => ({
        ticket: formatTicket(c.attendance.ticketNumber),
        code: c.attendance.code,
        room: c.room.name,
        calledAt: c.calledAt.toISOString(),
        recall: c.isRecall,
      })),
    };
  }
}
