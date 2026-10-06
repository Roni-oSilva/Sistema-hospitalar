import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS, classifySchema, releaseTriageSchema, saveTriageSchema, startTriageSchema, vitalsSchema } from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { TriageService } from './triage.service';

@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @RequirePermissions(PERMISSIONS.TRIAGE_QUEUE)
  @Get('queue')
  queue(@CurrentActor() actor: Actor) {
    return this.triage.queue(actor);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_PERFORM)
  @Post(':attendanceId/start')
  @HttpCode(200)
  start(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string, @Body(zbody(startTriageSchema)) body: z.infer<typeof startTriageSchema>) {
    return this.triage.start(actor, id, body.takeover);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_READ)
  @Get(':attendanceId')
  get(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string) {
    return this.triage.get(actor, id);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_PERFORM)
  @Put(':attendanceId')
  save(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string, @Body(zbody(saveTriageSchema)) body: z.infer<typeof saveTriageSchema>) {
    return this.triage.save(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_PERFORM)
  @Post(':attendanceId/vitals')
  vitals(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string, @Body(zbody(vitalsSchema)) body: z.infer<typeof vitalsSchema>) {
    return this.triage.addVitals(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_CLASSIFY)
  @Post(':attendanceId/classify')
  @HttpCode(200)
  classify(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string, @Body(zbody(classifySchema)) body: z.infer<typeof classifySchema>) {
    return this.triage.classify(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_PERFORM)
  @Post(':attendanceId/finish')
  @HttpCode(200)
  finish(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string) {
    return this.triage.finish(actor, id);
  }

  @RequirePermissions(PERMISSIONS.TRIAGE_PERFORM)
  @Post(':attendanceId/release')
  @HttpCode(200)
  release(@CurrentActor() actor: Actor, @Param('attendanceId', ParseUUIDPipe) id: string, @Body(zbody(releaseTriageSchema)) body: z.infer<typeof releaseTriageSchema>) {
    return this.triage.release(actor, id, body.reason);
  }
}
