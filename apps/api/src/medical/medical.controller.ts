import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  PERMISSIONS,
  addDiagnosisSchema,
  addMedicalNoteSchema,
  callPatientSchema,
  callSpecificSchema,
  cancelPrescriptionItemSchema,
  finishConsultationSchema,
  prescriptionItemSchema,
  releaseCallSchema,
  removeDiagnosisSchema,
  saveConsultationSchema,
} from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { MedicalService } from './medical.service';

@Controller('medical')
export class MedicalController {
  constructor(private readonly medical: MedicalService) {}

  @RequirePermissions(PERMISSIONS.MEDICAL_QUEUE)
  @Get('queue')
  queue(@CurrentActor() actor: Actor) {
    return this.medical.queue(actor);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_CALL)
  @Post('queue/call-next')
  @HttpCode(200)
  callNext(@CurrentActor() actor: Actor, @Body(zbody(callPatientSchema)) body: z.infer<typeof callPatientSchema>) {
    return this.medical.callNext(actor, body.roomId);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_CALL)
  @Post('attendances/:id/call')
  @HttpCode(200)
  call(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(callSpecificSchema)) body: z.infer<typeof callSpecificSchema>) {
    return this.medical.callSpecific(actor, id, body.roomId, body.takeover);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_CALL)
  @Post('attendances/:id/recall')
  @HttpCode(200)
  recall(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medical.recall(actor, id);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_CALL)
  @Post('attendances/:id/release')
  @HttpCode(200)
  release(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(releaseCallSchema)) body: z.infer<typeof releaseCallSchema>) {
    return this.medical.release(actor, id, body.reason);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/start')
  @HttpCode(200)
  start(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medical.start(actor, id);
  }

  @RequirePermissions(PERMISSIONS.CONSULTATION_READ)
  @Get('attendances/:id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medical.get(actor, id);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Put('attendances/:id/consultation')
  save(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(saveConsultationSchema)) body: z.infer<typeof saveConsultationSchema>) {
    return this.medical.saveConsultation(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/diagnoses')
  addDiagnosis(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(addDiagnosisSchema)) body: z.infer<typeof addDiagnosisSchema>) {
    return this.medical.addDiagnosis(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/diagnoses/:diagnosisId/remove')
  @HttpCode(200)
  removeDiagnosis(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('diagnosisId', ParseUUIDPipe) diagnosisId: string,
    @Body(zbody(removeDiagnosisSchema)) body: z.infer<typeof removeDiagnosisSchema>,
  ) {
    return this.medical.removeDiagnosis(actor, id, diagnosisId, body.reason);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/prescription/items')
  addItem(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(prescriptionItemSchema)) body: z.infer<typeof prescriptionItemSchema>) {
    return this.medical.addPrescriptionItem(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/prescription/items/:itemId/cancel')
  @HttpCode(200)
  cancelItem(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zbody(cancelPrescriptionItemSchema)) body: z.infer<typeof cancelPrescriptionItemSchema>,
  ) {
    return this.medical.cancelPrescriptionItem(actor, id, itemId, body.reason);
  }

  @RequirePermissions(PERMISSIONS.MEDICAL_ATTEND)
  @Post('attendances/:id/finish')
  @HttpCode(200)
  finish(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(finishConsultationSchema)) body: z.infer<typeof finishConsultationSchema>) {
    return this.medical.finish(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.CONSULTATION_READ)
  @Post('attendances/:id/notes')
  addNote(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(addMedicalNoteSchema)) body: z.infer<typeof addMedicalNoteSchema>) {
    return this.medical.addNote(actor, id, body.content);
  }

  @RequirePermissions(PERMISSIONS.CLINICAL_HISTORY_READ)
  @Get('attendances/:id/history')
  history(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medical.patientHistory(actor, id);
  }

  @RequirePermissions(PERMISSIONS.CONSULTATION_READ)
  @Get('attendances/:id/versions/:versionId')
  version(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.medical.getVersion(actor, id, versionId);
  }
}
