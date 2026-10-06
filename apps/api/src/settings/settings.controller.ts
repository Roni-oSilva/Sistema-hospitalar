import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PERMISSIONS, updateSettingSchema } from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequirePermissions, AuthenticatedOnly } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @Get('admin/settings')
  list() {
    return this.settings.list();
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @Put('admin/settings/:key')
  update(@CurrentActor() actor: Actor, @Param('key') key: string, @Body(zbody(updateSettingSchema)) body: z.infer<typeof updateSettingSchema>) {
    return this.settings.set(actor, key, body.value);
  }

  /** Parâmetros não sensíveis que qualquer usuário autenticado precisa para a interface (nome do hospital, metas de espera). */
  @AuthenticatedOnly()
  @Get('settings/public')
  async publicSettings() {
    return {
      hospitalName: await this.settings.get('hospital.name'),
      protocolName: await this.settings.get('triage.protocol_name'),
      maxWaitMinutes: await this.settings.get('triage.max_wait_minutes'),
      legalPriorityTiebreak: await this.settings.get('queue.legal_priority_tiebreak'),
      idleMinutes: await this.settings.get('session.idle_minutes'),
    };
  }
}
