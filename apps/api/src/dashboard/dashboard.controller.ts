import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@hospital/shared';
import { RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Contadores (recepção, triagem, médico e administração). Apenas números — nenhum dado de paciente. */
  @RequireAnyPermission(PERMISSIONS.ATTENDANCES_READ, PERMISSIONS.INDICATORS_READ, PERMISSIONS.TRIAGE_QUEUE, PERMISSIONS.MEDICAL_QUEUE)
  @Get('summary')
  summary(@Query('date') date?: string) {
    return this.dashboard.summary(date);
  }

  @RequirePermissions(PERMISSIONS.INDICATORS_READ)
  @Get('indicators')
  indicators(@Query('date') date?: string) {
    return this.dashboard.indicators(date);
  }
}
