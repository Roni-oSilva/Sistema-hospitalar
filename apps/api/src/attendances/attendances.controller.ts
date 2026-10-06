import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  cancelAttendanceSchema,
  createAttendanceSchema,
  listAttendancesSchema,
  updateAttendanceAccessibilitySchema,
} from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { AttendancesService } from './attendances.service';

@Controller('attendances')
export class AttendancesController {
  constructor(private readonly attendances: AttendancesService) {}

  @RequirePermissions(PERMISSIONS.ATTENDANCES_CREATE)
  @Post()
  create(@CurrentActor() actor: Actor, @Body(zbody(createAttendanceSchema)) body: z.infer<typeof createAttendanceSchema>) {
    return this.attendances.create(actor, body);
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCES_READ)
  @Get()
  list(@CurrentActor() actor: Actor, @Query(zbody(listAttendancesSchema)) query: z.infer<typeof listAttendancesSchema>) {
    return this.attendances.list(actor, query);
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCES_READ)
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendances.get(actor, id);
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCES_READ)
  @Get(':id/timeline')
  timeline(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendances.timeline(actor, id);
  }

  @RequirePermissions(PERMISSIONS.ACCESSIBILITY_WRITE)
  @Put(':id/accessibility')
  accessibility(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zbody(updateAttendanceAccessibilitySchema)) body: z.infer<typeof updateAttendanceAccessibilitySchema>,
  ) {
    return this.attendances.updateAccessibility(actor, id, body);
  }

  /** As regras finas (quem cancela em qual etapa) ficam no serviço. */
  @RequireAnyPermission(PERMISSIONS.ATTENDANCES_CANCEL, PERMISSIONS.TRIAGE_PERFORM, PERMISSIONS.MEDICAL_ATTEND)
  @Post(':id/cancel')
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(cancelAttendanceSchema)) body: z.infer<typeof cancelAttendanceSchema>) {
    return this.attendances.cancel(actor, id, body.reason);
  }
}
