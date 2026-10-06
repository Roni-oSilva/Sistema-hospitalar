import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, createPatientSchema, patientSearchSchema, updatePatientSchema } from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { PatientsService } from './patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @RequirePermissions(PERMISSIONS.PATIENTS_SEARCH)
  @Get('search')
  search(@CurrentActor() actor: Actor, @Query(zbody(patientSearchSchema)) query: z.infer<typeof patientSearchSchema>) {
    return this.patients.search(actor, query);
  }

  @RequirePermissions(PERMISSIONS.PATIENTS_READ)
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(actor, id);
  }

  @RequirePermissions(PERMISSIONS.PATIENTS_READ, PERMISSIONS.ATTENDANCES_READ)
  @Get(':id/attendances')
  attendances(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.attendances(actor, id);
  }

  @RequirePermissions(PERMISSIONS.PATIENTS_WRITE)
  @Post()
  create(@CurrentActor() actor: Actor, @Body(zbody(createPatientSchema)) body: z.infer<typeof createPatientSchema>) {
    return this.patients.create(actor, body);
  }

  @RequirePermissions(PERMISSIONS.PATIENTS_WRITE)
  @Put(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(updatePatientSchema)) body: z.infer<typeof updatePatientSchema>) {
    return this.patients.update(actor, id, body);
  }
}
