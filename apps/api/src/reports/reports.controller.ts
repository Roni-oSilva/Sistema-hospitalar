import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@hospital/shared';
import { CurrentActor, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @Get('overview')
  overview(@CurrentActor() actor: Actor, @Query('from') from: string, @Query('to') to: string) {
    return this.reports.overview(actor, String(from ?? ''), String(to ?? ''));
  }
}
